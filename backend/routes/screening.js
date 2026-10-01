// backend/routes/screening.js
// Admin API behind the call-screening dashboard (/dashboard).
// Every route requires the x-admin-secret header to match ADMIN_SECRET.

const crypto = require('crypto');
const express = require('express');
const validate = require('../triage/validate');

function secretMatches(given, expected) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!secretMatches(req.headers['x-admin-secret'], process.env.ADMIN_SECRET)) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }
  next();
}

function toE164(raw) {
  const parsed = validate.analyze(String(raw || ''));
  return parsed.valid ? parsed.e164 : null;
}

// deps: { store, blacklist, scamNumbers, screener, screeningEnabled }
function createScreeningRouter({ store, blacklist, scamNumbers, screener, screeningEnabled }) {
  const router = express.Router();
  router.use(requireAdmin);

  router.get('/state', (req, res) => {
    res.json({
      success: true,
      enabled: screeningEnabled(),
      settings: { ...store.settings },
      allowlist: Array.from(store.allowlist),
      blacklist: Array.from(blacklist),
      decisions: store.decisions.slice(0, 100),
      stats: store.stats(),
    });
  });

  router.post('/settings', (req, res) => {
    try {
      res.json({ success: true, settings: store.updateSettings(req.body || {}) });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /screening/list  { list: 'allow'|'block', number, op: 'add'|'remove' }
  router.post('/list', (req, res) => {
    const { list, number, op } = req.body || {};
    const target = list === 'allow' ? store.allowlist : list === 'block' ? blacklist : null;
    if (!target) return res.status(400).json({ success: false, error: "list must be 'allow' or 'block'" });
    if (op !== 'add' && op !== 'remove') return res.status(400).json({ success: false, error: "op must be 'add' or 'remove'" });
    const e164 = toE164(number);
    if (!e164) return res.status(400).json({ success: false, error: 'Enter a valid phone number' });

    if (op === 'add') {
      target.add(e164);
      // A number can't be on both lists.
      (target === blacklist ? store.allowlist : blacklist).delete(e164);
    } else {
      target.delete(e164);
    }
    res.json({ success: true, number: e164, allowlist: Array.from(store.allowlist), blacklist: Array.from(blacklist) });
  });

  // Dry run: what would happen if this number called right now?
  router.post('/check', async (req, res) => {
    const { number } = req.body || {};
    if (!number) return res.status(400).json({ success: false, error: 'number required' });
    const result = await screener.screen({
      from: String(number),
      lists: { allowlist: store.allowlist, blacklist, scamNumbers },
      settings: store.settings,
    });
    res.json({ success: true, result });
  });

  return router;
}

module.exports = { createScreeningRouter, requireAdmin, secretMatches };
