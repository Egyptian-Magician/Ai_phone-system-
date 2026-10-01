# Call Shield — call screening for Angelina

Call Shield checks every inbound call to your Twilio/Angelina number **before
Angelina picks up**, and decides what happens to it:

| Outcome | What the caller gets |
|---|---|
| **Allow** | Angelina answers as normal (and can transfer to you). |
| **Voicemail** | A short greeting and a beep; the message is saved in your Twilio console. |
| **Block** | The call is rejected. |
| **Honeypot** | Angelina's existing scammer time-waster. |

You manage it from a web dashboard that installs on your phone like an app.

## How a call is judged

In order, first match wins:

1. **Your allowlist** → always allowed.
2. **Your blocklist** (or a known scam number) → your chosen action (honeypot by default).
3. **Hidden caller ID** → your chosen action (voicemail by default).
4. Otherwise a **0–100 risk score** from:
   - spam/fraud reputation (IPQualityScore, if `IPQS_API_KEY` is set),
   - the carrier's **STIR/SHAKEN** caller-ID check (a failed check adds 25; a fully verified "A" check subtracts 15),
   - invalid number (+30) or VoIP line (+10).

   The **strictness** setting turns the score into an action:

   | Strictness | Voicemail at | Block at |
   |---|---|---|
   | Relaxed | 70+ | 90+ |
   | Balanced (default) | 50+ | 80+ |
   | Strict | 35+ | 65+ |

Lookups are limited to 4 seconds (`SCREEN_BUDGET_MS`) so a slow provider never
holds up a call, and each number is cached for 24 hours.

> Without `IPQS_API_KEY`, there is no reputation data, so most unknown callers
> score low and are allowed. Lists, hidden-ID handling and STIR/SHAKEN still
> work. Add the key for real spam detection.

## Turn it on

Set these on the Angelina backend (e.g. Render → Environment):

| Variable | Required | Purpose |
|---|---|---|
| `SCREENING_ENABLED` | yes | `true` to screen calls. Off by default. |
| `ADMIN_SECRET` | yes | Password for the dashboard. Admin routes refuse all requests if unset. |
| `IPQS_API_KEY` | recommended | Spam/fraud reputation. Free tier at ipqualityscore.com. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | optional | Carrier + line-type lookup. |
| `SCREENING_ALLOWLIST` | optional | Comma-separated numbers always allowed (survives restarts). |
| `SCREENING_BLOCKLIST` | optional | Comma-separated numbers always blocked (survives restarts). |
| `SCREEN_BUDGET_MS` | optional | Lookup time limit in ms (default 4000). |

Your Twilio number's voice webhook must already point at `/voice` on this
server (it does if Angelina answers calls today).

## Open the dashboard

Go to `https://<your-angelina-server>/dashboard/` and sign in with `ADMIN_SECRET`.

**Install it on your phone:**
- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu ⋮ → *Install app* (or *Add to Home screen*).

From the dashboard you can see recent calls and why each was handled the way
it was, add numbers to your allow/block lists (or tap *Always allow / Always
block* on a recent call), change strictness, and check what would happen if a
number called.

> Lists and settings changed in the dashboard are kept in memory and reset
> when the server restarts or redeploys. Put numbers you always want in
> `SCREENING_ALLOWLIST` / `SCREENING_BLOCKLIST` so they stick.

## Screening your personal cell phone

A website can't block calls on your phone directly, but you can route calls
through Angelina so they're screened first. Pick one:

### Option A — Give out the Angelina number (best protection)
Use your Twilio number as your public number and keep your cell private.
Every call is screened. Set `TRANSFER_NUMBER` to your cell so Angelina can put
real callers through to you.

### Option B — Forward calls you don't answer (easiest)
Your cell rings as normal; calls you miss, decline, or can't take go to
Angelina and get screened. Dial these from your cell, replacing
`NUMBER` with your Twilio number (digits only, with country code, e.g. `18555182214`):

| Carrier | Turn on | Turn off |
|---|---|---|
| AT&T, T-Mobile, most GSM | `**004*NUMBER#` (no answer, busy, unreachable) | `##004#` |
| Verizon | `*71NUMBER` (no answer / busy) | `*73` |

Codes vary by carrier and plan; if one doesn't work, search
"conditional call forwarding" + your carrier, or set it in your phone's
call settings.

### Don't forward *all* calls if `TRANSFER_NUMBER` is that same cell
If your cell forwards every call to Angelina and Angelina transfers back to
that cell, the call bounces in a loop. Use Option A, or Option B (conditional
forwarding), or point `TRANSFER_NUMBER` at a different phone.

## Files

- `policy.js` — the decision rules (pure, unit-tested).
- `screen.js` — runs the lookup with a time limit and cache, then decides.
- `store.js` — settings, allowlist, recent-decision log.
- `twiml.js` — the Twilio response for block / voicemail.
- `../routes/screening.js` — admin API used by the dashboard.
- `../public/dashboard/` — the dashboard web app.

Run the tests with `npm test` in `backend/`.
