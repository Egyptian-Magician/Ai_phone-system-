// backend/triage/lookup.js
// Live carrier / line-type / CNAM lookups via authorized APIs.
// Reuses the app's Twilio client if provided; every provider is optional.

const TIMEOUT_MS = 15000;

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = await resp.text();
    let json;
    try { json = JSON.parse(body); } catch { json = null; }
    return { ok: resp.ok, status: resp.status, json, body };
  } finally {
    clearTimeout(t);
  }
}

// Uses an already-constructed twilio client (from server.js) to avoid
// duplicating credentials. Falls back to skipped if none supplied.
async function twilioLookup(e164, twilioClient) {
  if (!twilioClient) return { status: 'skipped', reason: 'no twilio client' };
  try {
    const data = await twilioClient.lookups.v2
      .phoneNumbers(e164)
      .fetch({ fields: 'line_type_intelligence,caller_name' });
    const lti = data.lineTypeIntelligence || {};
    const cn = data.callerName || {};
    return {
      status: 'ok',
      valid: data.valid,
      carrier: lti.carrier_name || null,
      lineType: lti.type || null, // mobile | landline | voip | nonFixedVoip
      callerName: cn.caller_name || null,
      callerType: cn.caller_type || null,
    };
  } catch (err) {
    return { status: 'error', reason: err.message };
  }
}

async function numverifyLookup(e164) {
  const key = process.env.NUMVERIFY_API_KEY;
  if (!key) return { status: 'skipped', reason: 'no NUMVERIFY_API_KEY' };
  const number = e164.replace(/^\+/, '');
  const url = `http://apilayer.net/api/validate?access_key=${key}&number=${number}`;
  const r = await fetchJson(url);
  if (!r.ok) return { status: 'error', http: r.status };
  const d = r.json || {};
  if (d.success === false) return { status: 'error', detail: d.error };
  return {
    status: 'ok',
    valid: d.valid,
    carrier: d.carrier || null,
    lineType: d.line_type || null,
    location: d.location || null,
  };
}

async function run(e164, twilioClient) {
  const out = {
    twilio: await twilioLookup(e164, twilioClient),
    numverify: await numverifyLookup(e164),
  };
  let lineType = null;
  let carrier = null;
  for (const src of ['twilio', 'numverify']) {
    const d = out[src];
    if (d.status === 'ok') {
      lineType = lineType || d.lineType;
      carrier = carrier || d.carrier;
    }
  }
  out.verdict = {
    lineType,
    carrier,
    isVoip: !!(lineType && String(lineType).toLowerCase().includes('voip')),
    isGoogleVoice: !!(carrier && String(carrier).toLowerCase().includes('google')),
  };
  return out;
}

module.exports = { run, twilioLookup, numverifyLookup, fetchJson };
