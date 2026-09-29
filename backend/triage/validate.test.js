// Tests for validate.js (offline, no network).
const test = require('node:test');
const assert = require('node:assert');
const { analyze } = require('./validate');

test('valid US number parses with region and E.164', () => {
  const r = analyze('+18583998883');
  assert.equal(r.valid, true);
  assert.equal(r.region, 'US');
  assert.equal(r.e164, '+18583998883');
  assert.equal(r.national, '(858) 399-8883');
});

test('accepts national format with default region', () => {
  const r = analyze('(858) 399-8883', 'US');
  assert.equal(r.valid, true);
  assert.equal(r.e164, '+18583998883');
});

test('garbage input is invalid, not thrown', () => {
  const r = analyze('not-a-number');
  assert.equal(r.valid, false);
  assert.ok(r.error);
});

test('empty input is handled gracefully', () => {
  const r = analyze('');
  assert.equal(r.valid, false);
});

test('toll-free number reports a line type', () => {
  const r = analyze('+18005551234');
  // May be valid or not depending on metadata, but must not throw and must
  // expose a lineType string.
  assert.equal(typeof r.lineType, 'string');
});

test('voipOrGoogleVoiceHint is boolean for valid numbers', () => {
  const r = analyze('+18583998883');
  assert.equal(typeof r.voipOrGoogleVoiceHint, 'boolean');
});
