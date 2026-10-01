// Tests for username.js. Network calls are avoided; we test the input guard
// and the integrity of the site table.
const test = require('node:test');
const assert = require('node:assert');
const { check, SITES } = require('./username');

test('rejects invalid username format without hitting the network', async () => {
  const r = await check('bad name!!');
  assert.equal(r.status, 'error');
  assert.match(r.reason, /invalid/i);
});

test('rejects overly long usernames', async () => {
  const r = await check('a'.repeat(60));
  assert.equal(r.status, 'error');
});

test('every site entry is well-formed', () => {
  assert.ok(SITES.length > 0);
  for (const s of SITES) {
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.url, 'function');
    assert.ok(['status', 'absence'].includes(s.detect));
    // URL builder must embed the username and produce an https URL.
    const u = s.url('testuser');
    assert.match(u, /^https:\/\//);
    assert.ok(u.includes('testuser'), `${s.name} URL should include the username`);
    if (s.detect === 'absence') {
      assert.equal(typeof s.absent, 'string', `${s.name} needs an 'absent' marker`);
    }
  }
});
