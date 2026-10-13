# Watchword — design

Date: 2026-10-13 · Target: Amazon "Build, Ship, Shape" hackathon, Ring track (+ AWS Builder mini challenge) · Deadline: 2026-10-23 12:00 PDT

## Intent

Anyone with a Ring camera types, in plain English, what they want watched at their door — and Watchword does it.

- "Tell me when the kids get home from school on weekdays. If nobody's home by 4pm, alert me."
- "If a package sits on the porch for more than 2 hours, remind me."
- "Any activity at the front door between midnight and 5am."
- "Let me know when the cleaner leaves; warn me if they're still there at 3pm check-in."

Users: parents, caregivers, short-term-rental hosts, small shops. Success: a polished, working web app and a <3 min demo video submitted by Oct 23, using real Ring APIs and Amazon Bedrock.

The differentiator vs Ring's own features: user-authored rules in free text, and **absence/duration rules** (things that did *not* happen, or lasted too long). Ring's AI descriptions require Ring Pro and its unusual-event alerts are learned, not described.

## Constraints

- No paid subscriptions. Ring access is via the **Ring Playground** (simulated DoorbellPro, 30-min tokens, three simulated live-view streams: Package/Vehicle/Motion). The Playground does not emit motion/ding webhooks, so a **feeder** posts Ring-shaped, HMAC-signed events to our real webhook endpoint (organizer-approved approach). The demo labels which footage is Ring's and which is ours.
- No face recognition / identity (Ring content policy §4.2; Nova 2 also refuses). Rules describe *what* to look for ("a child with a backpack"), never *who*.
- AWS spend ≤ $5 total. Estimated ~$1.65 through submission.

## Architecture

One Cloudflare Worker (Vite + React UI served as static assets, API routes in the same Worker).

```
Ring API (Playground) ──┐
Feeder (demo console) ──┼─► POST /ring/webhook  (HMAC verify, dedupe request_id, 200 in <5s)
                        │        └─ waitUntil: frame → R2 → Bedrock evaluate (all rules, 1 call) → D1 → alert
User text ──────────────► POST /api/rules → Bedrock compile → rule JSON → user confirms
Cron * * * * * ─────────► deadline + duration checks; retry unanalyzed events
```

Stack: Cloudflare Workers, D1, R2, Cron Triggers, Cloudflare Email Service (fallback: Resend), Amazon Bedrock (Nova 2 Lite via Converse API, signed with `aws4fetch`).

## Units

1. **ring** — Ring API client (`api.amazonvision.com`, JSON:API, Bearer token). Lists devices, status, event history; fetches a frame for an event (snapshot/clip if the Playground serves them, else a frame from the live stream, else the feeder's image). Token from Settings (Playground) for now.
2. **webhook** — verifies HMAC with the app's key, dedupes on `request_id`, stores the raw event, schedules processing with `ctx.waitUntil`, returns 200 immediately.
3. **feeder** — demo console in the UI plus a script; uploads a scene image and posts a Ring-format event (motion or ding) signed with the same HMAC key.
4. **compile** — text → `Rule` via Bedrock with a JSON schema (tool use). Returns a plain-English summary the user confirms before saving.
5. **evaluate** — one Bedrock call per event: image + every active rule's `look_for` → per rule `{match, confidence, reason}` plus a one-line caption.
6. **engine** — pure functions, no I/O: given rules, matches, and `now` (in the household time zone), decide which alerts fire. Covers all four rule kinds. This is where the tests live.
7. **alerts** — email with snapshot, rule, reason; record in D1; live feed in the UI (polling every 3s).
8. **budget** — daily Bedrock call counter in D1; hard cap 300/day; over cap → event stored as `unanalyzed`.
9. **ui** — Rules (big textbox, example chips, rule cards), Today (snapshot timeline with rule badges), Alerts, Settings (Ring token, alert email, time zone), Demo console.

## Rule model

```ts
type Rule = {
  id: string
  text: string                 // what the user typed
  summary: string              // compiled plain-English restatement
  kind: 'arrival' | 'deadline' | 'duration' | 'window'
  look_for: string             // visual description for the evaluator
  days: number[]               // 0=Sun..6=Sat; empty = every day
  start: string | null         // "HH:MM" local, window start
  end: string | null           // "HH:MM" local, window end / deadline
  minutes: number | null       // duration threshold
  severity: 'info' | 'urgent'
  enabled: boolean
}
```

Semantics (local time, per day):
- **arrival** — alert on first match inside the window (once per day).
- **deadline** — if no match between `start` and `end`, alert at `end` (once per day). A match before `end` sends an info "all good" note.
- **duration** — on match, open an episode; if the thing is still seen after `minutes` (re-checked from the latest frame by cron), alert once; closes when a frame no longer matches.
- **window** — alert on any match inside the window (deduped to one per 10 min).

A sentence that implies two rules (arrival + deadline) compiles to two rules.

## Data (D1)

`settings(key, value)` · `rules(...)` · `events(id, request_id unique, device_id, kind, occurred_at, image_key, caption, status)` · `matches(event_id, rule_id, match, confidence, reason)` · `episodes(rule_id, opened_at, last_seen_at, closed_at, alerted)` · `alerts(id, rule_id, event_id, fired_at, title, body, severity)` · `usage(day, calls)`.

Images in R2 under `frames/<event_id>.jpg`, served through the Worker.

## Error handling

- Bedrock failure or over budget → event saved with `status='unanalyzed'`; cron retries (under budget).
- No frame available → event recorded, rules not evaluated, shown as "no image".
- Bad HMAC → 401, nothing stored. Duplicate `request_id` → 200, no-op.
- Compile returns invalid JSON → one retry, then a friendly "try rephrasing" message.

## Security / privacy

Single household per deployment; UI and API behind an app token (`APP_TOKEN` secret). Secrets: `RING_HMAC_KEY`, `AWS_ACCESS_KEY_ID/SECRET` (IAM user limited to `bedrock:InvokeModel` on Nova 2 Lite), `APP_TOKEN`. Frames are stored only in the household's own R2 bucket. Copy in the app states that Watchword never identifies people.

## Testing

- `engine` unit tests (vitest) for all four kinds, day/time-zone boundaries, once-per-day dedupe.
- HMAC verify test.
- `scripts/eval.ts` — ~10 labelled images × rules through the real Bedrock evaluator; prints accuracy. Run before recording.

## Out of scope

Multi-household accounts, Ring partner OAuth flow (documented as next step), face recognition, mobile apps, SMS, per-camera rule targeting.

## Submission checklist

Public repo with MIT license and setup instructions · <3 min video (parent → host → shop) · product feedback for Ring API, Playground, Bedrock, Cloudflare · friction log kept in `docs/friction-log.md` from day 1 (up to 10% bonus) · AWS Builder: documented Bedrock integration.
