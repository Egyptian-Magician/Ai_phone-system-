// backend/screening/store.js
// In-memory screening state: settings, allowlist, and a rolling log of
// recent decisions for the dashboard. Matches the rest of the backend, which
// keeps its blacklist and call log in memory (reset on restart).

const { STRICTNESS, ACTIONS } = require('./policy');
const validate = require('../triage/validate');

const MAX_DECISIONS = 200;

// "858-555-1234, +16195550142" -> ['+18585551234', '+16195550142'].
// Used to seed lists from env vars so they survive restarts/redeploys.
function parseNumberList(str) {
  return String(str || '')
    .split(',')
    .map((s) => validate.analyze(s.trim()))
    .filter((p) => p.valid)
    .map((p) => p.e164);
}

function createStore() {
  const settings = {
    strictness: 'balanced',
    blacklistAction: 'honeypot',
    anonymousAction: 'voicemail',
  };
  const allowlist = new Set();
  const decisions = []; // newest first

  function updateSettings(patch = {}) {
    if (patch.strictness !== undefined) {
      if (!STRICTNESS[patch.strictness]) throw new Error('strictness must be one of: ' + Object.keys(STRICTNESS).join(', '));
      settings.strictness = patch.strictness;
    }
    for (const key of ['blacklistAction', 'anonymousAction']) {
      if (patch[key] !== undefined) {
        if (!ACTIONS.includes(patch[key])) throw new Error(key + ' must be one of: ' + ACTIONS.join(', '));
        settings[key] = patch[key];
      }
    }
    return { ...settings };
  }

  function record(entry) {
    decisions.unshift({ ...entry, time: new Date().toISOString() });
    if (decisions.length > MAX_DECISIONS) decisions.length = MAX_DECISIONS;
  }

  function stats() {
    const counts = { allow: 0, voicemail: 0, block: 0, honeypot: 0 };
    for (const d of decisions) if (counts[d.action] !== undefined) counts[d.action] += 1;
    return { total: decisions.length, ...counts };
  }

  return { settings, allowlist, decisions, updateSettings, record, stats };
}

module.exports = { createStore, parseNumberList, MAX_DECISIONS };
