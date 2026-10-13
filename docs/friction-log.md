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
