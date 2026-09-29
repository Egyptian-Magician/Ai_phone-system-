// Tests for the orchestrator's authorization gate and offline behavior.
// An invalid number yields no E.164, so no live/reputation network calls run.
const test = require('node:test');
const assert = require('node:assert');
const { triage, NotAuthorizedError } = require('./index');

test('throws NotAuthorizedError when not authorized', async () => {
  await assert.rejects(
    () => triage({ number: '+18583998883', authorized: false }),
    NotAuthorizedError
  );
});

test('defaults to unauthorized when the flag is omitted', async () => {
  await assert.rejects(
    () => triage({ number: '+18583998883' }),
    NotAuthorizedError
  );
});

test('authorized invalid number returns an offline report, no network', async () => {
  const r = await triage({ number: 'not-a-number', authorized: true });
  assert.equal(r.validation.valid, false);
  // No e164 => live lookup and phone reputation are skipped entirely.
  assert.equal(r.liveLookup, undefined);
  assert.equal(r.phoneReputation, undefined);
  assert.ok(r.generated);
});

test('email adds a static disposable signal without a key', async () => {
  const r = await triage({
    number: 'not-a-number',
    email: 'x@mailinator.com',
    authorized: true,
  });
  assert.equal(r.identifier.target, 'x@mailinator.com');
  assert.equal(r.identifier.static.likelyDisposable, true);
});
