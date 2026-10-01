// Tests for the screening decision logic (pure, no network).
const test = require('node:test');
const assert = require('node:assert');
const { decide, scoreReport } = require('./policy');

const clean = { validation: { valid: true, e164: '+18585551234' } };
const rep = (fields) => ({ ...clean, phoneReputation: { status: 'ok', ...fields } });

test('allowlist wins over everything, including a blocklist entry', () => {
  const n = '+18585551234';
  const r = decide({ number: n, report: rep({ fraudScore: 100, spammer: true }), lists: { allowlist: new Set([n]), blacklist: new Set([n]) } });
  assert.equal(r.action, 'allow');
  assert.equal(r.rule, 'allowlist');
});

test('blocklisted number goes to honeypot by default', () => {
  const n = '+18585551234';
  const r = decide({ number: n, report: clean, lists: { blacklist: new Set([n]) } });
  assert.equal(r.action, 'honeypot');
  assert.equal(r.rule, 'blocklist');
});

test('blocklist action is configurable', () => {
  const n = '+18585551234';
  const r = decide({ number: n, report: clean, lists: { scamNumbers: new Set([n]) }, settings: { blacklistAction: 'block' } });
  assert.equal(r.action, 'block');
});

test('hidden caller ID goes to voicemail by default', () => {
  for (const from of ['anonymous', 'Restricted', '+266696687', null]) {
    const r = decide({ number: from, report: {} });
    assert.equal(r.action, 'voicemail', `for ${from}`);
    assert.equal(r.rule, 'hidden');
  }
});

test('clean number with no reputation data is allowed', () => {
  const r = decide({ number: '+18585551234', report: clean });
  assert.equal(r.action, 'allow');
  assert.equal(r.score, 0);
});

test('reported spammer is blocked on balanced', () => {
  const r = decide({ number: '+18585551234', report: rep({ fraudScore: 40, spammer: true }) });
  assert.equal(r.action, 'block');
  assert.ok(r.reasons.includes('reported spammer'));
});

test('strictness changes the outcome for the same score', () => {
  const report = rep({ fraudScore: 60 });
  const args = { number: '+18585551234', report };
  assert.equal(decide({ ...args, settings: { strictness: 'relaxed' } }).action, 'allow');
  assert.equal(decide({ ...args, settings: { strictness: 'balanced' } }).action, 'voicemail');
  assert.equal(decide({ ...args, settings: { strictness: 'strict' } }).action, 'voicemail');
  const higher = rep({ fraudScore: 70 });
  assert.equal(decide({ number: '+18585551234', report: higher, settings: { strictness: 'strict' } }).action, 'block');
});

test('unknown strictness falls back to balanced', () => {
  const r = decide({ number: '+18585551234', report: rep({ fraudScore: 55 }), settings: { strictness: 'nonsense' } });
  assert.equal(r.action, 'voicemail');
});

test('STIR/SHAKEN failure raises the score, Passed-A lowers it', () => {
  const failed = scoreReport(rep({ fraudScore: 40 }), { stirVerstat: 'TN-Validation-Failed-B' });
  const passed = scoreReport(rep({ fraudScore: 40 }), { stirVerstat: 'TN-Validation-Passed-A' });
  assert.equal(failed.score, 65);
  assert.equal(passed.score, 25);
  assert.ok(failed.reasons.some((x) => /failed carrier verification/.test(x)));
});

test('VoIP line adds a small bump', () => {
  const r = scoreReport({ validation: { valid: true, voipOrGoogleVoiceHint: true } });
  assert.equal(r.score, 10);
});

test('invalid number adds 30', () => {
  const r = scoreReport({ validation: { valid: false } });
  assert.equal(r.score, 30);
});

test('score is clamped to 0..100', () => {
  assert.equal(scoreReport(rep({ fraudScore: 100 }), { stirVerstat: 'TN-Validation-Failed' }).score, 100);
  assert.equal(scoreReport(clean, { stirVerstat: 'TN-Validation-Passed-A' }).score, 0);
});
