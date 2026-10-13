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
- **Expected vs actual:** Device discovery works, but status says `"online": false` and event history is empty. The 303 points to a pre-signed URL that returns `416 MEDIA_NOT_FOUND`. Sending `{"type":"latest"}` returns `403 REQUEST_FORBIDDEN` ("missing required timestamp fields"), which looks like an auth failure but is a validation error.
- **Severity:** Medium. The snapshot path can't be tested end to end without a real device.
- **Workaround:** The demo uses scene images; the app falls back to "no frame" when the snapshot is unavailable.
- **Suggestion:** Return 400 for malformed bodies, and say which Playground actions create media that snapshots can fetch.
