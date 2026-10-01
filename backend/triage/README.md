# Caller Triage (authorized OSINT)

A defensive triage module for the Angelina phone system. Given a phone number
(and optionally an email or username you're investigating for abuse), it
returns **reputation and exposure signals** so you can screen spam/scam callers
and audit exposure of numbers you own.

## What it reports

- **Validation & line type** (`validate.js`) — region, number type, and a
  heuristic **VoIP / Google Voice** flag via `libphonenumber-js` (offline).
- **Live carrier / CNAM** (`lookup.js`) — carrier, line type, and caller name
  via Twilio Lookup (reuses the app's Twilio creds) or NumVerify. Sets
  `isVoip` and `isGoogleVoice`.
- **Spam / fraud reputation** (`reputation.js`) — phone fraud score via
  IPQualityScore; email reputation + Have I Been Pwned breach exposure +
  disposable-domain check for an identifier.
- **Username presence** (`username.js`) — Sherlock-style check of whether a
  handle resolves on ~20 public sites. Presence is a signal, not proof of
  identity (same handle ≠ same person).

## What it deliberately does NOT do

- No GPS / cell-tower / real-time location — not obtainable from a number via
  OSINT; anything claiming it is a scam or spyware.
- No resolution of a number to a private person's name or home address.

## Authorized use only

Use only on: numbers/identifiers **you own**, a **client engagement with
written scope**, or **abuse/fraud** directed at you or your client. Every call
must pass `authorized: true`. This is a guardrail, not a legal shield —
misusing OSINT to track or profile a private individual can violate stalking,
privacy (CCPA/CPRA), and computer-abuse laws.

## HTTP endpoints

Both are **off by default** and require the request to assert authorization.

### Angelina backend (`backend/server.js`) — admin only
```
POST /triage
Header: x-admin-secret: <ADMIN_SECRET>
Body:   { "number": "+1858...", "email": "x@y.com", "handle": "someuser",
          "region": "US", "authorized": true }
```
Also returns `knownToSystem` (is the number already blacklisted / a known scam
number in this instance).

### Softphone server (`server.js`) — feature-flagged
```
POST /api/triage        (requires env TRIAGE_ENABLED=true)
Body: { "number": "+1858...", "authorized": true, ... }
```

## Environment variables (all optional)

| Var | Purpose |
|-----|---------|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio Lookup (carrier, line type, CNAM, Google-Voice confirm) |
| `NUMVERIFY_API_KEY` | Fallback carrier / line-type lookup |
| `IPQS_API_KEY` | Phone + email spam/fraud reputation (IPQualityScore) |
| `HIBP_API_KEY` | Breach exposure for an email (Have I Been Pwned) |
| `TRIAGE_ENABLED` | `true` to enable `/api/triage` on the softphone server |
| `ADMIN_SECRET` | Protects `/triage` on the Angelina backend (already used by other admin routes) |

Providers with no key are marked `skipped`; the rest still run. The offline
validation / line-type step needs no keys at all.

## Programmatic use

```js
const { triage } = require('./triage');
const report = await triage({
  number: '+18585551234',
  email: 'suspect@example.com',
  handle: 'suspecthandle',
  authorized: true,
  twilioClient, // optional; enables Twilio Lookup
});
```
