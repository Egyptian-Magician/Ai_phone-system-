// backend/screening/policy.js
// Pure decision logic: given what we know about an inbound caller, decide
// whether to let the call through, send it to voicemail, block it, or route
// it to the honeypot. No I/O here so it is fully unit-testable.

const STRICTNESS = {
  relaxed:  { block: 90, voicemail: 70 },
  balanced: { block: 80, voicemail: 50 },
  strict:   { block: 65, voicemail: 35 },
};

const ACTIONS = ['allow', 'voicemail', 'block', 'honeypot'];

// STIR/SHAKEN result Twilio passes as `StirVerstat` on inbound calls.
// "Passed-A" = carrier vouches for the caller ID; "Failed" = likely spoofed.
function stirAdjustment(stirVerstat) {
  const v = String(stirVerstat || '');
  if (!v) return { points: 0 };
  if (/Failed/i.test(v)) return { points: 25, reason: 'caller ID failed carrier verification' };
  if (/Passed-A/i.test(v)) return { points: -15, reason: 'caller ID verified by carrier' };
  return { points: 0 };
}

// Turn a triage report (see backend/triage) into a 0-100 risk score.
function scoreReport(report = {}, { stirVerstat } = {}) {
  const reasons = [];
  let score = 0;

  const v = report.validation || {};
  if (v.valid === false) {
    score += 30;
    reasons.push('invalid number');
  }

  const rep = report.phoneReputation;
  if (rep && rep.status === 'ok') {
    if (typeof rep.fraudScore === 'number') score = Math.max(score, rep.fraudScore);
    if (rep.spammer) { score = Math.max(score, 90); reasons.push('reported spammer'); }
    if (rep.recentAbuse) { score = Math.max(score, 80); reasons.push('recent abuse'); }
  }

  const verdict = report.liveLookup && report.liveLookup.verdict;
  if ((verdict && verdict.isVoip) || v.voipOrGoogleVoiceHint) {
    score += 10;
    reasons.push('VoIP line');
  }

  const stir = stirAdjustment(stirVerstat);
  score += stir.points;
  if (stir.reason) reasons.push(stir.reason);

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

// decide({ number, report, stirVerstat, lists, settings })
//   lists:    { allowlist: Set, blacklist: Set, scamNumbers: Set }
//   settings: { strictness, blacklistAction, anonymousAction }
function decide({ number, report, stirVerstat, lists = {}, settings = {} }) {
  const allowlist = lists.allowlist || new Set();
  const blacklist = lists.blacklist || new Set();
  const scamNumbers = lists.scamNumbers || new Set();
  const strictness = STRICTNESS[settings.strictness] ? settings.strictness : 'balanced';
  const blacklistAction = ACTIONS.includes(settings.blacklistAction) ? settings.blacklistAction : 'honeypot';
  const anonymousAction = ACTIONS.includes(settings.anonymousAction) ? settings.anonymousAction : 'voicemail';

  if (number && allowlist.has(number)) {
    return { action: 'allow', score: 0, rule: 'allowlist', reasons: ['on your allowlist'] };
  }
  if (number && (blacklist.has(number) || scamNumbers.has(number))) {
    return { action: blacklistAction, score: 100, rule: 'blocklist', reasons: ['on your blocklist'] };
  }

  // Twilio reports withheld caller ID as "anonymous"/"+266696687".
  const hidden = !number || /^(anonymous|unknown|restricted|private)$/i.test(number) || number === '+266696687';
  if (hidden) {
    return { action: anonymousAction, score: 50, rule: 'hidden', reasons: ['caller ID hidden'] };
  }

  const { score, reasons } = scoreReport(report, { stirVerstat });
  const t = STRICTNESS[strictness];
  let action = 'allow';
  if (score >= t.block) action = 'block';
  else if (score >= t.voicemail) action = 'voicemail';
  return { action, score, rule: 'score', reasons };
}

module.exports = { decide, scoreReport, STRICTNESS, ACTIONS };
