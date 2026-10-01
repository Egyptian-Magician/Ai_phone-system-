// backend/triage/index.js
// Orchestrator: authorized-only phone/identifier triage.

const validate = require('./validate');
const lookup = require('./lookup');
const reputation = require('./reputation');
const username = require('./username');

// The caller must explicitly assert authorization. This is a guardrail, not a
// legal shield: use only on numbers/identifiers you own, a client engagement
// with written scope, or abuse/fraud directed at you.
class NotAuthorizedError extends Error {}

async function triage(opts = {}) {
  const {
    number,
    email = null,
    handle = null,
    region = 'US',
    authorized = false,
    twilioClient = null,
  } = opts;

  if (!authorized) {
    throw new NotAuthorizedError(
      'Authorization not asserted. Set authorized=true and use only on ' +
        'numbers/identifiers you own or are engaged/investigating with scope.'
    );
  }

  const report = { generated: new Date().toISOString() };
  report.validation = validate.analyze(number, region);

  const e164 = report.validation.e164;
  if (e164) {
    report.liveLookup = await lookup.run(e164, twilioClient);
    report.phoneReputation = await reputation.phoneSpamIpqs(e164);
  }

  if (email) {
    report.identifier = {
      target: email,
      emailReputation: await reputation.emailReputationIpqs(email),
      breaches: await reputation.emailBreachesHibp(email),
      static: reputation.emailStaticChecks(email),
    };
  }

  if (handle) {
    report.usernamePresence = await username.check(handle);
  }

  return report;
}

module.exports = { triage, NotAuthorizedError };
