# Watchword

**Tell your Ring camera what to watch for — in plain words.**

> “Tell me when the kids get home from school. If nobody’s home by 4pm, alert me.”

Watchword turns that sentence into watch rules, checks every Ring event against them with Amazon Bedrock, and alerts you when something happens — **or when it doesn’t**. Ring’s alerts fire on events; Watchword also catches the absence of one (nobody home by 4pm) and things that last too long (a package sitting on the porch for 2 hours).

Built for the Amazon “Build, Ship, Shape” hackathon — **Ring track** + **AWS Builder** mini challenge.

Live: https://watchword.kalashshah47.workers.dev

## Who it’s for

| | Example |
|---|---|
| Parents | “Tell me when the kids get home on weekdays; alert me if not by 4pm.” |
| Rental hosts | “Let me know when the cleaner leaves; warn me if they’re still there at 3pm check-in.” |
| Everyone | “If a package sits on the porch more than 2 hours, remind me.” · “Any activity between midnight and 5am.” |
| Shops | “Tell me when the delivery van arrives.” · “Alert me if more than 5 people are waiting outside.” |

## How it works

```
Ring webhook (motion_detected / button_press, HMAC-signed)
   │  verify X-Signature on raw body → dedupe request_id → 200 in < 5 s
   ▼
Frame: Ring Image Snapshot API (POST /v1/devices/{id}/media/image/download)
   ▼
Amazon Bedrock · Nova 2 Lite (Converse API)
   one call checks the frame against every active rule → match, confidence, reason, caption
   ▼
Rule engine (pure, tested)          Cron, every minute
   arrival · window                    deadline: "didn't happen by 4pm"
                                       duration: "still there after 2h"
   ▼
Alerts: email with snapshot (Cloudflare Email Service) + live feed in the app
```

Four rule kinds, compiled from free text by Bedrock and shown back in plain English before saving:

| Kind | Fires when |
|---|---|
| `arrival` | the thing is first seen inside its window (once a day) |
| `deadline` | the window closes and it was **never** seen |
| `duration` | it’s still seen after N minutes |
| `window` | anything matching happens inside a time range |

**Privacy:** rules describe what to look for — clothing, objects, vehicles — never who. No face recognition (Ring content policy §4.2; Nova 2 also declines to identify people).

## Ring integration

- **Webhooks** — `POST /ring/webhook` implements Ring’s v1.1 payload: `X-Signature: sha256=<hex HMAC-SHA256(raw body)>`, idempotent on `meta.request_id`, `motion_detected` with `sub_type` (human / vehicle / package_delivery) and `button_press`. See `worker/webhook.ts`, `worker/hmac.ts`.
- **Device API** — device discovery + status (`GET /v1/devices`, `/status`) and event history. `worker/ring.ts`.
- **Image Snapshots** — `POST …/media/image/download` (`at_timestamp`, follows the 303 to the pre-signed URL).
- **Playground** — paste a [Ring Developer Playground](https://developer.amazon.com/ring/console/playground) token in Settings to connect the simulated DoorbellPro.

**Why there’s a demo console:** the Playground can’t emit motion or doorbell webhooks (confirmed by organizers on the hackathon forum). The Demo page — and `scripts/feed.ts` — build Ring v1.1 payloads exactly as documented, sign them with the same HMAC scheme, and deliver them through the real webhook route. Events from it are labelled “Simulated event” in the UI. Demo scene images are AI-generated stand-ins for doorbell footage.

## AWS (Builder mini challenge)

| Service | Use |
|---|---|
| **Amazon Bedrock — Nova 2 Lite** | `compileRules()`: sentence → structured rules (JSON). `evaluateFrame()`: image + all rules → per-rule match in one call. Converse API, SigV4-signed with `aws4fetch` from a Cloudflare Worker. `worker/ai.ts` |
| **IAM** | a dedicated user allowed only `bedrock:InvokeModel` on Nova 2 Lite |
| **AWS Budgets** | $3 alert on the account |

Cost: images bill a flat 230 tokens on Nova 2 Lite, so a frame check is ~1,000 input + ~150 output tokens ≈ **$0.00075**. A hard cap of 300 Bedrock calls/day is enforced in D1; past it, events are saved but not analyzed. Total build + demo spend: under $2.

## Stack

Cloudflare Workers (Hono) · D1 · R2 · Cron Triggers · Email Service · React 19 + Vite · Amazon Bedrock · vitest

## Run it

```bash
pnpm install
cp .dev.vars.example .dev.vars        # APP_TOKEN, RING_HMAC_KEY, AWS keys
npx wrangler d1 migrations apply watchword --local
pnpm dev                              # http://localhost:5173 — sign in with APP_TOKEN
pnpm test                             # engine, parsers, HMAC
```

Send a signed Ring-format event from the terminal:

```bash
node scripts/feed.ts http://localhost:5173/ring/webhook <RING_HMAC_KEY> motion_detected human
```

Deploy:

```bash
npx wrangler d1 create watchword && npx wrangler r2 bucket create watchword-frames
# put the database_id in wrangler.jsonc, set APP_URL / EMAIL_FROM vars
npx wrangler d1 migrations apply watchword --remote
pnpm run deploy
npx wrangler secret put APP_TOKEN        # and RING_HMAC_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
```

## Project layout

```
worker/engine.ts     rule decisions — pure, unit-tested (time zones, overnight windows, once-a-day)
worker/ai.ts         Bedrock compile + evaluate, daily budget
worker/webhook.ts    Ring webhook receiver
worker/pipeline.ts   event → frame → Bedrock → alerts; minute tick
worker/ring.ts       Ring Partner API client
worker/api.ts        JSON API for the UI + demo console
src/                 React UI
docs/friction-log.md what tripped us up, for the Ring and AWS teams
```

## What’s next

Ring partner OAuth account linking (replacing Playground tokens), per-camera rules, push notifications, and re-checking a fresh snapshot before “still there” alerts.

## License

MIT
