// backend/triage/validate.js
// Offline number validation + line-type heuristics using libphonenumber-js.

const { parsePhoneNumberFromString } = require('libphonenumber-js');

// Carriers commonly behind VoIP / Google Voice US numbers. Heuristic only:
// number portability means a live carrier lookup is authoritative.
const VOIP_HINT_CARRIERS = [
  'google', 'bandwidth', 'twilio', 'onvoy', 'level 3',
  'peerless', 'inteliquent', 'voip',
];

function analyze(raw, defaultCountry = 'US') {
  const result = { input: raw, valid: false };
  let num;
  try {
    num = parsePhoneNumberFromString(String(raw || ''), defaultCountry);
  } catch (err) {
    result.error = `parse_error: ${err.message}`;
    return result;
  }
  if (!num) {
    result.error = 'unparseable';
    return result;
  }

  result.valid = num.isValid();
  result.possible = num.isPossible();
  result.e164 = num.number;
  result.national = num.formatNational();
  result.countryCode = num.countryCallingCode;
  result.region = num.country || null;
  // getType() -> 'MOBILE' | 'FIXED_LINE' | 'VOIP' | 'FIXED_LINE_OR_MOBILE' | ...
  const t = num.getType();
  result.lineType = t ? t.toLowerCase() : 'unknown';
  result.voipOrGoogleVoiceHint = result.lineType === 'voip';
  result.note =
    'VoIP/Google Voice hint is heuristic. Confirm with a live carrier ' +
    'lookup; number portability can change the real carrier.';
  return result;
}

module.exports = { analyze, VOIP_HINT_CARRIERS };
