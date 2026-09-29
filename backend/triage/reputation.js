// backend/triage/reputation.js
// Spam / abuse reputation for numbers and identifiers. Abuse signals only,
// not owner identification. All providers optional.

const { fetchJson } = require('./lookup');

const DISPOSABLE_HINTS = [
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail',
  'trashmail', 'yopmail.com', 'sharklasers.com', 'getnada.com',
  'dispostable.com', 'maildrop.cc',
];

async function phoneSpamIpqs(e164) {
  const key = process.env.IPQS_API_KEY;
  if (!key) return { status: 'skipped', reason: 'no IPQS_API_KEY' };
  const number = e164.replace(/^\+/, '');
  const url = `https://ipqualityscore.com/api/json/phone/${key}/${number}`;
  const r = await fetchJson(url);
  if (!r.ok) return { status: 'error', http: r.status };
  const d = r.json || {};
  if (d.success === false) return { status: 'error', detail: d.message };
  return {
    status: 'ok',
    fraudScore: d.fraud_score,
    recentAbuse: d.recent_abuse,
    risky: d.risky,
    spammer: d.spammer,
    active: d.active,
    lineType: d.line_type,
    carrier: d.carrier,
    voip: d.VOIP,
    prepaid: d.prepaid,
  };
}

async function emailReputationIpqs(email) {
  const key = process.env.IPQS_API_KEY;
  if (!key) return { status: 'skipped', reason: 'no IPQS_API_KEY' };
  const url = `https://ipqualityscore.com/api/json/email/${key}/${encodeURIComponent(email)}`;
  const r = await fetchJson(url);
  if (!r.ok) return { status: 'error', http: r.status };
  const d = r.json || {};
  return {
    status: 'ok',
    fraudScore: d.fraud_score,
    disposable: d.disposable,
    recentAbuse: d.recent_abuse,
    spamTrapScore: d.spam_trap_score,
    honeypot: d.honeypot,
    deliverability: d.deliverability,
    firstSeen: (d.first_seen || {}).human,
  };
}

async function emailBreachesHibp(email) {
  const key = process.env.HIBP_API_KEY;
  if (!key) return { status: 'skipped', reason: 'no HIBP_API_KEY' };
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`;
  const r = await fetchJson(url, {
    headers: { 'hibp-api-key': key, 'user-agent': 'ai-phone-system-triage' },
  });
  if (r.status === 404) return { status: 'ok', breachCount: 0, breaches: [] };
  if (!r.ok) return { status: 'error', http: r.status };
  const breaches = (r.json || []).map((b) => b.Name);
  return { status: 'ok', breachCount: breaches.length, breaches };
}

function emailStaticChecks(email) {
  const domain = email.includes('@') ? email.split('@').pop().toLowerCase() : '';
  const likelyDisposable = DISPOSABLE_HINTS.some((h) => domain.includes(h));
  return { status: 'ok', domain: domain || null, likelyDisposable };
}

module.exports = {
  phoneSpamIpqs, emailReputationIpqs, emailBreachesHibp, emailStaticChecks,
};
