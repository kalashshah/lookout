# Friction log

Format: task · steps · expected vs actual · severity · workaround · suggestion.

## 1. Webhook auth differs between sample and docs
- **Task:** Implement Ring webhook verification.
- **Steps:** Read `ring-api-helloworld` webhook route, then API docs "Notifications".
- **Expected vs actual:** Sample checks `Authorization: Bearer <RING_WEBHOOK_SECRET>`; docs require `X-Signature: sha256=<hex HMAC>`. The sample would reject real Ring webhooks if a secret is set.
- **Severity:** Medium.
- **Workaround:** Followed the docs (HMAC over raw body).
- **Suggestion:** Update the sample to verify `X-Signature`, matching the docs.

## 2. Playground can't emit motion/button webhooks
- **Task:** Test an event-driven app without a Ring device.
- **Steps:** Ring Playground → simulated DoorbellPro → Package/Vehicle/Motion buttons.
- **Expected vs actual:** Expected webhook delivery to my endpoint; the buttons only start simulated live views (confirmed by organizers in the forum).
- **Severity:** High for event-driven apps.
- **Workaround:** A feeder posts Ring v1.1 payloads, signed like Ring, to the real webhook path.
- **Suggestion:** Let the Playground send signed test webhooks (motion with sub_type, button_press) to a configured URL.

## 3. Playground device is offline; snapshots return 416 and a bad body returns 403
- **Task:** Fetch a frame for an event with the Image Snapshot API on a Playground token.
- **Steps:** `GET /v1/devices`, `/status`, `/capabilities` → `POST /v1/devices/{id}/media/image/download` with `at_timestamp` → follow the 303.
- **Expected vs actual:** Device discovery works, but status says `"online": false` and event history is empty. The 303 points to a pre-signed URL that returns `416 MEDIA_NOT_FOUND`. Sending `{"type":"latest"}` returns `403 REQUEST_FORBIDDEN` ("missing required timestamp fields"), which looks like an auth failure but is a validation error. Starting a Playground live stream adds an `on_demand` history event (start/end shown), but snapshot and video downloads (`media/video/download` with `duration`) inside that exact range still return 416, so Playground live views store no media.
- **Severity:** Medium. The snapshot path can't be tested end to end without a real device.
- **Workaround:** The demo uses scene images; the app falls back to "no frame" when the snapshot is unavailable.
- **Suggestion:** Return 400 for malformed bodies, and say which Playground actions create media that snapshots can fetch.

## 4. Finding the Bedrock inference profile id for Nova 2 Lite
- **Task:** Call Nova 2 Lite through the Bedrock Converse API from a serverless backend.
- **Steps:** Looked up the model in the Bedrock docs and console to find the id to put in the `/model/{id}/converse` URL.
- **Expected vs actual:** Expected the model page to give the id to call. The id that works is the cross-region inference profile (`us.amazon.nova-2-lite-v1:0`), and finding it took longer than writing the integration itself.
- **Severity:** Low. It costs time once.
- **Workaround:** Set the inference profile id as `MODEL_ID` in config.
- **Suggestion:** Show the inference profile id next to the model id on each model page and in the Converse quickstart.

## 5. Nova 2 Lite sometimes echoes rule ids with an "id " prefix
- **Task:** Get a per-rule match back from one multimodal call (snapshot plus every active rule, JSON out, temperature 0).
- **Steps:** Listed rules in the prompt as `- <id>: <what to look for>`, and the system prompt asks for `{"caption", "matches":[{"id","match","confidence","reason"}]}` with "Use the ids exactly as given."
- **Expected vs actual:** Expected the ids back exactly. The model occasionally returned them as `"id <rule-id>"`, which would silently drop that rule's match. Confidence values also cluster around 0.95, so they're less useful than the `reason` text.
- **Severity:** Medium. A dropped match means a missed alert, and nothing errors.
- **Workaround:** The parser strips a leading `id ` before matching (`parseEvaluation()` in `worker/ai.ts`), and the app relies on the `match` flag and `reason`, not confidence. `scripts/eval.ts` runs every demo scene through the real model to catch regressions.
- **Suggestion:** Support a JSON schema or structured output for Nova on Converse, so field values come back exactly as specified.
