// Tests for screening settings, the decision log, and admin auth.
const test = require('node:test');
const assert = require('node:assert');
const { createStore, parseNumberList, MAX_DECISIONS } = require('./store');

test('parseNumberList normalizes valid numbers and drops junk', () => {
  assert.deepEqual(parseNumberList('858-399-8883, +16195550142 ,junk,,'), ['+18583998883', '+16195550142']);
  assert.deepEqual(parseNumberList(undefined), []);
});
const { secretMatches } = require('../routes/screening');

test('settings accept valid values and reject invalid ones', () => {
  const store = createStore();
  assert.equal(store.updateSettings({ strictness: 'strict' }).strictness, 'strict');
  assert.throws(() => store.updateSettings({ strictness: 'extreme' }));
  assert.throws(() => store.updateSettings({ anonymousAction: 'explode' }));
  assert.equal(store.settings.strictness, 'strict');
});

test('decision log is newest-first, capped, and counted', () => {
  const store = createStore();
  for (let i = 0; i < MAX_DECISIONS + 5; i += 1) {
    store.record({ number: String(i), action: i % 2 ? 'block' : 'allow' });
  }
  assert.equal(store.decisions.length, MAX_DECISIONS);
  assert.equal(store.decisions[0].number, String(MAX_DECISIONS + 4));
  const s = store.stats();
  assert.equal(s.total, MAX_DECISIONS);
  assert.equal(s.allow + s.block, MAX_DECISIONS);
});

test('admin secret check fails closed', () => {
  assert.equal(secretMatches(undefined, undefined), false, 'unset secret must not grant access');
  assert.equal(secretMatches('', ''), false);
  assert.equal(secretMatches('abc', 'abc'), true);
  assert.equal(secretMatches('abd', 'abc'), false);
  assert.equal(secretMatches('abcd', 'abc'), false);
  assert.equal(secretMatches(['abc'], 'abc'), false);
});
