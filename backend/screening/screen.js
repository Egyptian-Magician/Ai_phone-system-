// backend/screening/screen.js
// Runs the triage lookup for an inbound caller under a strict time budget,
// caches the result, and hands it to the policy for a decision.
//
// Twilio waits ~15s for the /voice webhook, so live lookups are capped at
// SCREEN_BUDGET_MS. If they don't finish in time, we decide on whatever is
// known locally (lists, STIR/SHAKEN, offline validation) instead of stalling.

const { decide } = require('./policy');
const validate = require('../triage/validate');

const DEFAULT_BUDGET_MS = 4000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function createScreener({ triage, lookupClient = null, budgetMs = DEFAULT_BUDGET_MS, now = () => Date.now() } = {}) {
  const cache = new Map(); // e164 -> { report, at }

  async function lookup(e164) {
    const hit = cache.get(e164);
    if (hit && now() - hit.at < CACHE_TTL_MS) return { report: hit.report, cached: true };

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
    });
    try {
      const report = await Promise.race([
        triage({ number: e164, authorized: true, twilioClient: lookupClient }),
        timeout,
      ]);
      if (report) {
        cache.set(e164, { report, at: now() });
        return { report, cached: false };
      }
      return { report: null, timedOut: true };
    } catch (err) {
      return { report: null, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }

  // screen({ from, stirVerstat, lists, settings })
  async function screen({ from, stirVerstat, lists, settings }) {
    const parsed = from ? validate.analyze(from) : { valid: false };
    const number = parsed.e164 || from || null;

    // Lists and hidden-ID rules don't need a network lookup.
    const quick = decide({ number, report: { validation: parsed }, stirVerstat, lists, settings });
    if (quick.rule !== 'score' || !parsed.e164) {
      return { number, ...quick, source: 'local' };
    }

    const { report, cached, timedOut, error } = await lookup(parsed.e164);
    const result = decide({
      number,
      report: report || { validation: parsed },
      stirVerstat,
      lists,
      settings,
    });
    let source = 'lookup';
    if (cached) source = 'cache';
    if (timedOut) source = 'timeout';
    if (error) source = 'error';
    return { number, ...result, source };
  }

  return { screen, cache };
}

module.exports = { createScreener, DEFAULT_BUDGET_MS };
