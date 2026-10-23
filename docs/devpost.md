# Devpost submission: Lookout

Text for the "Build, Ship, Shape" form. Two placeholders to fill in before pasting: `<ACCESS_CODE>` (the household access code, which is `APP_TOKEN`) and `<YOUTUBE_URL>`.

Tracks: Ring (primary) and AWS Builder (mini challenge)
Repo: https://github.com/kalashshah/lookout (public, MIT)
Live: https://lookout.keronlabs.com
Video: <YOUTUBE_URL>

---

## Project description

Tell your Ring doorbell what to watch for, in plain words.

> "Tell me when the kids get home from school. If nobody's home by 4pm, alert me."

Ring tells you when something moves. Lookout tells you what it means, and it also notices when something doesn't happen. You type a sentence. Amazon Bedrock turns it into watch rules and reads them back before anything is saved. Every Ring motion or doorbell event is checked against all of your rules in one Bedrock call, and you get an email with the snapshot plus a live feed in the app.

Four kinds of rule come out of ordinary sentences:

| Kind | Example | Fires when |
|---|---|---|
| When it happens | "Tell me when the delivery van arrives." | first seen inside its window, once a day |
| If it hasn't happened by | "If nobody's home by 4pm, alert me." | the window closes and it was never seen |
| If it lasts too long | "If a package sits on the porch for 2 hours, remind me." | still seen after N minutes |
| During a time window | "Any activity between midnight and 5am." | anything matching inside the hours |

The absence and duration rules are the reason the project exists. Ring's alerts fire on events, so "nobody came" and "still there" are exactly the two things a doorbell can't tell you today. Parents, caregivers, short-term-rental hosts and small shops all ask these questions.

Privacy: rules describe what to look for, such as clothing, objects or vehicles. They never identify a person. There is no face recognition and no naming (Ring content policy §4.2; Nova 2 declines to identify people as well). Bedrock calls are capped at 300 a day, and any rule can be paused with one tap.

### How it's built

Ring: `POST /ring/webhook` implements the v1.1 payload. The `X-Signature: sha256=<HMAC-SHA256 of the raw body>` header is verified before the body is parsed, delivery is idempotent on `meta.request_id`, and both `motion_detected` (with `sub_type` human, vehicle or package_delivery) and `button_press` are handled. The route returns 200 immediately and processes in the background. The app also uses device discovery and status (`GET /v1/devices`, `/status`), event history, and Image Snapshots (`POST /v1/devices/{id}/media/image/download`, following the 303 to the pre-signed URL). The Playground's simulated DoorbellPro connects from Settings with a Playground token.

Amazon Bedrock, Nova 2 Lite over the Converse API: `compileRules()` turns the sentence into structured rules (kind, a visual `look_for`, days, window, duration, severity) with a plain-English summary the user confirms. `evaluateFrame()` sends the snapshot and every active rule's `look_for` in one call and gets back a caption plus a per-rule match, confidence and reason. Requests are SigV4-signed with `aws4fetch` from a Cloudflare Worker. A dedicated IAM user is allowed only `bedrock:InvokeModel`, and a $3 AWS Budget alert is set. A frame check is about 1,000 input and 150 output tokens, roughly $0.0008.

Cloudflare: one Worker (Hono) serves the React UI as static assets. D1 holds rules, events, matches, episodes, alerts and usage; R2 holds frames; a 1-minute Cron Trigger runs the "didn't happen" and "still there" checks; Email Service sends alerts with the snapshot attached.

Rule engine: pure functions with 46 unit tests covering overnight windows, once-a-day dedupe, time zones, "missed" firing exactly once even though the cron runs every minute, and duplicate webhooks never double-alerting.

### The demo and the Playground

The Ring Playground can't emit motion or doorbell webhooks (the organizers confirmed this on the forum). The Demo page in the app, and `scripts/feed.ts`, build Ring v1.1 payloads exactly as documented, sign them with the same HMAC scheme, and deliver them through the real webhook route. Events from it are labelled "Simulated event" in the UI. Demo scene images are AI-generated stand-ins for doorbell footage.

---

## Testing instructions for judges

1. Open https://lookout.keronlabs.com and click Start watching. Household access code: `<ACCESS_CODE>`.
2. Watch: type what to watch for, or click an example. Bedrock compiles it. Check the cards read right, then Start watching saves them.
3. Demo: pick a scene (for example Kids home from school), set a time, and click Send Ring event. The event goes through the real signed webhook, the frame is checked against every rule, and an alert pops in the corner within a few seconds.
4. Today shows every event with its caption and which rules it matched. Alerts lists what fired.
5. For the absence rules: click Clear events & alerts, then Run clock to 4:05 PM. "Nobody home by 4pm" fires because nothing matching was seen. Send Package left at 1:05 PM and run the clock to 3:10 PM to see "Still there".
6. Settings: paste a Ring Developer Playground token to list the simulated DoorbellPro and its status, and add an email address to receive alerts with the snapshot.

It is a single household, so if several judges test at once you will see each other's events. Bedrock checks are capped at 300 a day; past the cap, events are saved but not analyzed.

From a terminal, a signed Ring-format event:

```
node scripts/feed.ts https://lookout.keronlabs.com/ring/webhook <RING_HMAC_KEY> motion_detected human
```

---

## Product feedback

### Ring developer platform (Partner API, webhooks, Playground)

Used for: webhook notifications (motion_detected and button_press), device discovery and status, event history, and image snapshots.

What worked well: the webhook spec is precise (raw-body HMAC, request_id for idempotency, the 5-second rule) and was easy to implement correctly. The JSON:API device endpoints are clean. The Playground gives you a device and a token in a minute.

What needs work: the `ring-api-helloworld` sample verifies `Authorization: Bearer` while the docs specify `X-Signature` HMAC, so the sample would reject real webhooks. The Playground can't emit motion or doorbell webhooks, so an event-driven app can't be tested end to end. Playground snapshots return `416 MEDIA_NOT_FOUND`, and a malformed snapshot body returns `403 REQUEST_FORBIDDEN`, which reads as an auth error when it is a validation error. Playground tokens expire in about 30 minutes.

Onboarding: zero to a listed device took under an hour. Zero to a received webhook was not possible without building a feeder.

Would we build with it again? Yes. The API is well designed. The gaps are in the test tooling, and they are fixable.

### Amazon Bedrock, Nova 2 Lite (AWS Builder)

Used for: compiling free text into structured rules, and one-call multi-rule evaluation of a frame (caption plus per-rule match, confidence and reason).

What worked well: the Converse API from a Cloudflare Worker with SigV4 via `aws4fetch` worked first time. Nova 2 Lite follows a strict JSON contract reliably at `temperature: 0`. Flat 230-token image pricing makes the per-event cost predictable at about $0.0008. The model declines to identify people, which matched our privacy rule.

What needs work: the model occasionally echoes rule ids with an `id ` prefix (we accept both). Confidence values cluster at 0.95, so they are less useful than the `reason` text. Finding the exact cross-region inference-profile id (`us.amazon.nova-2-lite-v1:0`) took longer than the integration itself.

Onboarding: an IAM user with a single `bedrock:InvokeModel` policy, a Budgets alert, and a first successful call within the hour. Total spend for the build and the demo was under $2.

Would we build with it again? Yes. The cost, latency and accuracy are right for frame understanding in a consumer product.

### Cloudflare (Workers, D1, R2, Cron Triggers, Email Service)

What worked well: one Worker runs the UI, the API, the webhook and the cron. D1 `INSERT OR IGNORE` on `request_id` gives idempotency for free. The Vite plugin dev loop is fast. Email Service sends with an attachment from a binding, with no API key to manage.

What needs work: a bare `wrangler deploy` after editing `wrangler.jsonc` ships the stale config the Vite plugin generated at the last build (we lost the workers.dev route once this way). Adding a custom domain silently disables workers.dev unless `workers_dev: true` is explicit.

Would we build with it again? Yes.

---

## Feature requests (optional)

| Request | Why it matters | Priority |
|---|---|---|
| A Playground button that sends a signed test webhook (motion with sub_type, button_press) to a configured URL | Event-driven apps can't be tested end to end today | Critical |
| Playground live views that store media, so Image Snapshots return a frame | Snapshot code paths can't be tested without hardware | Important |
| Return 400 instead of 403 for malformed snapshot request bodies | 403 sends developers to debug auth instead of the body | Nice-to-have |
| Longer-lived Playground tokens, or a refresh flow | 30-minute tokens interrupt demos and testing | Nice-to-have |

## Friction log

Three entries in the required format (task, steps, expected vs actual, severity, workaround, suggestion) are in `docs/friction-log.md` in the repo. In short:

1. Webhook auth differs between the sample and the docs. The sample checks a Bearer token; the docs require `X-Signature` HMAC. Severity medium. We followed the docs. Suggestion: fix the sample.
2. The Playground can't emit motion or button webhooks; its buttons only start simulated live views. Severity high for event-driven apps. We built a feeder that signs Ring v1.1 payloads. Suggestion: let the Playground send signed test webhooks.
3. The Playground device reports `online: false` with an empty history. Snapshots return `416 MEDIA_NOT_FOUND` from the pre-signed URL, and `{"type":"latest"}` returns 403. Severity medium. We fall back to scene images, and the app handles "no frame". Suggestions: return 400 for malformed bodies, and document which Playground actions create media.
