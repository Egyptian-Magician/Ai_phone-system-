// backend/routes/triage.js
// Express router exposing the triage capability.
//
// Disabled unless TRIAGE_ENABLED=true, so it never ships on by default.
// Every request must carry authorized:true in the JSON body.

const express = require('express');
const { triage, NotAuthorizedError } = require('../triage');

// twilioClient is injected from server.js so we reuse existing credentials.
module.exports = function createTriageRouter(twilioClient) {
  const router = express.Router();

  const enabled = String(process.env.TRIAGE_ENABLED).toLowerCase() === 'true';

  router.use((req, res, next) => {
    if (!enabled) {
      return res.status(403).json({
        success: false,
        error: 'Triage disabled. Set TRIAGE_ENABLED=true to enable.',
      });
    }
    next();
  });

  // POST /api/triage  { number, email?, handle?, region?, authorized:true }
  router.post('/', async (req, res) => {
    const { number, email, handle, region, authorized } = req.body || {};
    if (!number) {
      return res.status(400).json({ success: false, error: 'number required' });
    }
    try {
      const report = await triage({
        number,
        email: email || null,
        handle: handle || null,
        region: region || 'US',
        authorized: authorized === true,
        twilioClient,
      });
      res.json({ success: true, report });
    } catch (err) {
      if (err instanceof NotAuthorizedError) {
        return res.status(403).json({ success: false, error: err.message });
      }
      console.error('Triage error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
