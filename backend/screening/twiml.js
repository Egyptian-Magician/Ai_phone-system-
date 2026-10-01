// backend/screening/twiml.js
// Writes the TwiML for a "block" or "voicemail" screening decision.
// "allow" and "honeypot" are handled by the existing /voice flow.

const VOICEMAIL_GREETING =
  "Sorry, I can't take your call right now. Please leave a message with your name and reason for calling after the tone.";

function applyDecision(twiml, decision) {
  if (decision.action === 'block') {
    twiml.reject({ reason: 'rejected' });
    return true;
  }
  if (decision.action === 'voicemail') {
    twiml.say({ voice: 'Polly.Joanna-Neural' }, VOICEMAIL_GREETING);
    twiml.record({ maxLength: 120, playBeep: true, finishOnKey: '#' });
    twiml.hangup();
    return true;
  }
  return false;
}

module.exports = { applyDecision, VOICEMAIL_GREETING };
