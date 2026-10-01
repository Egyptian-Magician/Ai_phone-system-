// Tests for reputation.js. Static checks are pure; provider calls must skip
// cleanly when no API key is configured.
const test = require('node:test');
const assert = require('node:assert');
const rep = require('./reputation');

test('emailStaticChecks flags known disposable domains', () => {
  const r = rep.emailStaticChecks('someone@mailinator.com');
  assert.equal(r.status, 'ok');
  assert.equal(r.domain, 'mailinator.com');
  assert.equal(r.likelyDisposable, true);
});

test('emailStaticChecks passes normal domains', () => {
  const r = rep.emailStaticChecks('kareem@example.com');
  assert.equal(r.likelyDisposable, false);
  assert.equal(r.domain, 'example.com');
});

test('emailStaticChecks handles malformed email', () => {
  const r = rep.emailStaticChecks('noatsign');
  assert.equal(r.status, 'ok');
  assert.equal(r.domain, null);
});

test('phoneSpamIpqs skips without IPQS_API_KEY', async () => {
  const saved = process.env.IPQS_API_KEY;
  delete process.env.IPQS_API_KEY;
  try {
    const r = await rep.phoneSpamIpqs('+18583998883');
    assert.equal(r.status, 'skipped');
  } finally {
    if (saved !== undefined) process.env.IPQS_API_KEY = saved;
  }
});

test('emailBreachesHibp skips without HIBP_API_KEY', async () => {
  const saved = process.env.HIBP_API_KEY;
  delete process.env.HIBP_API_KEY;
  try {
    const r = await rep.emailBreachesHibp('x@example.com');
    assert.equal(r.status, 'skipped');
  } finally {
    if (saved !== undefined) process.env.HIBP_API_KEY = saved;
  }
});
