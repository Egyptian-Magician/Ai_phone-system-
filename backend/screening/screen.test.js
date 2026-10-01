// Tests for the live screener: time budget, cache, and list short-circuits.
// The triage function is injected, so nothing touches the network.
const test = require('node:test');
const assert = require('node:assert');
const { createScreener } = require('./screen');
const { applyDecision } = require('./twiml');
const twilio = require('twilio');

const lists = () => ({ allowlist: new Set(), blacklist: new Set(), scamNumbers: new Set() });

test('uses the triage report to decide', async () => {
  const triage = async ({ number }) => ({
    validation: { valid: true, e164: number },
    phoneReputation: { status: 'ok', fraudScore: 95 },
  });
  const { screen } = createScreener({ triage });
  const r = await screen({ from: '+18585551234', lists: lists(), settings: {} });
  assert.equal(r.action, 'block');
  assert.equal(r.source, 'lookup');
});

test('caches lookups per number', async () => {
  let calls = 0;
  const triage = async ({ number }) => { calls += 1; return { validation: { valid: true, e164: number } }; };
  const { screen } = createScreener({ triage });
  await screen({ from: '+18585551234', lists: lists(), settings: {} });
  const second = await screen({ from: '+18585551234', lists: lists(), settings: {} });
  assert.equal(calls, 1);
  assert.equal(second.source, 'cache');
});

test('cache expires after 24h', async () => {
  let calls = 0;
  let clock = 0;
  const triage = async ({ number }) => { calls += 1; return { validation: { valid: true, e164: number } }; };
  const { screen } = createScreener({ triage, now: () => clock });
  await screen({ from: '+18585551234', lists: lists(), settings: {} });
  clock += 25 * 60 * 60 * 1000;
  await screen({ from: '+18585551234', lists: lists(), settings: {} });
  assert.equal(calls, 2);
});

test('slow lookup is abandoned after the budget and the call still gets a decision', async () => {
  const triage = () => new Promise((resolve) => setTimeout(() => resolve({}), 2000));
  const { screen } = createScreener({ triage, budgetMs: 50 });
  const started = Date.now();
  const r = await screen({ from: '+18585551234', lists: lists(), settings: {} });
  assert.ok(Date.now() - started < 1000, 'should not wait for the slow lookup');
  assert.equal(r.source, 'timeout');
  assert.equal(r.action, 'allow');
});

test('lookup errors fall back to a local decision', async () => {
  const triage = async () => { throw new Error('provider down'); };
  const { screen } = createScreener({ triage });
  const r = await screen({ from: '+18585551234', lists: lists(), settings: {} });
  assert.equal(r.source, 'error');
  assert.equal(r.action, 'allow');
});

test('listed and hidden callers skip the lookup entirely', async () => {
  let calls = 0;
  const triage = async () => { calls += 1; return {}; };
  const { screen } = createScreener({ triage });
  const l = lists();
  l.blacklist.add('+18585551234');
  const blocked = await screen({ from: '+18585551234', lists: l, settings: {} });
  const hidden = await screen({ from: 'anonymous', lists: lists(), settings: {} });
  assert.equal(calls, 0);
  assert.equal(blocked.action, 'honeypot');
  assert.equal(hidden.action, 'voicemail');
  assert.equal(blocked.source, 'local');
});

test('applyDecision writes Reject for block and Record for voicemail', () => {
  const blockTwiml = new twilio.twiml.VoiceResponse();
  assert.equal(applyDecision(blockTwiml, { action: 'block' }), true);
  assert.match(blockTwiml.toString(), /<Reject reason="rejected"\/>/);

  const vmTwiml = new twilio.twiml.VoiceResponse();
  assert.equal(applyDecision(vmTwiml, { action: 'voicemail' }), true);
  const xml = vmTwiml.toString();
  assert.match(xml, /<Record [^>]*maxLength="120"/);
  assert.match(xml, /<Hangup\/>/);

  const allowTwiml = new twilio.twiml.VoiceResponse();
  assert.equal(applyDecision(allowTwiml, { action: 'allow' }), false);
  assert.equal(applyDecision(allowTwiml, { action: 'honeypot' }), false);
});
