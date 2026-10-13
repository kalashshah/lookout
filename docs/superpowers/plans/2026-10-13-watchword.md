# Watchword Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare-hosted web app where a Ring owner types what to watch for, and Watchword evaluates Ring events with Amazon Bedrock and sends alerts — including for things that did *not* happen.

**Architecture:** One Worker (Hono API + Vite/React static UI via `@cloudflare/vite-plugin`). D1 for state, R2 for frames, a 1-minute cron for deadline/duration rules. Bedrock Nova 2 Lite (Converse API, SigV4 via `aws4fetch`) compiles rules and evaluates frames. Ring Partner API (`api.amazonvision.com`) for devices/history/snapshots; a feeder posts Ring v1.1 webhook payloads signed exactly as Ring does.

**Tech Stack:** TypeScript, Cloudflare Workers/D1/R2/Cron/Email, Hono, React 19 + Vite, vitest, aws4fetch.

**Spec:** `docs/superpowers/specs/2026-10-13-watchword-design.md`

## Global Constraints

- Deadline 2026-10-23 12:00 PDT; demo video < 3 min.
- AWS spend ≤ $5: model `Nova 2 Lite` only, extended thinking off, hard cap **300 Bedrock calls/day**.
- No face recognition or identity: prompts must never ask "who"; UI copy states this.
- Ring webhook format v1.1: `X-Signature: sha256=<hex HMAC-SHA256(raw body, key)>`; verify raw bytes before parsing; respond 200 within 5 s; dedupe on `meta.request_id`.
- Ring snapshot: `POST /v1/devices/{id}/media/image/download` → 303 to pre-signed URL.
- All times evaluated in the household time zone (`settings.tz`, IANA name).
- Repo public, MIT license; friction log kept in `docs/friction-log.md`.

## Review Focus

1. Overnight windows (`23:00–05:00`) — a match at 01:00 must count; tested in Task 2.
2. Deadline rule where the thing happened before the window opened (e.g. 13:00 for a 14:30–16:00 window) must still fire "missed" at 16:00; tested in Task 2.
3. Same webhook delivered twice (Ring retries) — must not double-alert; tested in Task 4.
4. Bedrock returns non-JSON or a rule id we didn't send — event is kept, no crash, no phantom alerts; tested in Task 3.
5. Cron runs every minute — "missed" and "lingering" must fire exactly once per day/episode; tested in Task 2.

## File Structure

```
wrangler.jsonc  vite.config.ts  package.json  tsconfig.json  index.html
migrations/0001_init.sql        D1 schema
worker/
  index.ts      Hono routes, auth cookie, scheduled() entry
  types.ts      Rule, Fire, Match, Env
  engine.ts     pure decision logic (no I/O)          + engine.test.ts
  hmac.ts       sign/verify Ring signatures            + hmac.test.ts
  ai.ts         Bedrock Converse: compileRules(), evaluateFrame(), budget
  ring.ts       Ring API client (devices, history, snapshot)
  db.ts         D1 queries
  pipeline.ts   processEvent(): frame → evaluate → engine → alerts; tick()
  alerts.ts     email send + record
src/            React UI: main.tsx App.tsx api.ts styles.css pages/*
scripts/feed.ts     CLI feeder (same signer as demo console)
scripts/eval.ts     accuracy check against labelled scenes
public/scenes/      demo scene images
```

---

### Task 1: Scaffold + schema

**Files:** Create `package.json`, `wrangler.jsonc`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `worker/index.ts`, `migrations/0001_init.sql`, `LICENSE`, `.gitignore`, `docs/friction-log.md`.

- [ ] Scaffold with `pnpm create cloudflare@latest` (React + Vite + Worker template), then add `hono`, `aws4fetch`, `vitest`.
- [ ] `wrangler.jsonc`: D1 binding `DB`, R2 binding `FRAMES`, `triggers.crons: ["* * * * *"]`, `assets.not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*", "/ring/*"]`.
- [ ] Schema:

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE rules (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, summary TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('arrival','deadline','duration','window')),
  look_for TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[]',
  start TEXT, "end" TEXT, minutes INTEGER,
  severity TEXT NOT NULL DEFAULT 'info', enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL);
CREATE TABLE events (
  id TEXT PRIMARY KEY, request_id TEXT UNIQUE, device_id TEXT, type TEXT NOT NULL,
  sub_type TEXT, at INTEGER NOT NULL, image_key TEXT, caption TEXT,
  status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL DEFAULT 'ring');
CREATE TABLE matches (event_id TEXT, rule_id TEXT, match INTEGER, confidence REAL, reason TEXT,
  PRIMARY KEY (event_id, rule_id));
CREATE TABLE episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, closed_at INTEGER, alerted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE alerts (id TEXT PRIMARY KEY, rule_id TEXT, event_id TEXT, at INTEGER NOT NULL,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, severity TEXT NOT NULL, local_date TEXT NOT NULL);
CREATE TABLE usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL);
CREATE INDEX alerts_rule_date ON alerts(rule_id, local_date);
CREATE INDEX events_at ON events(at);
```

- [ ] `wrangler d1 create watchword`, `wrangler r2 bucket create watchword-frames`, apply migration locally; `pnpm dev` serves a hello page and `GET /api/health` → `{ok:true}`.
- [ ] Commit `chore: scaffold watchword`.

### Task 2: Rule engine (pure)

**Files:** `worker/types.ts`, `worker/engine.ts`, `worker/engine.test.ts`

**Produces:**
```ts
type Rule = { id; text; summary; kind: 'arrival'|'deadline'|'duration'|'window'; look_for;
  days: number[]; start: string|null; end: string|null; minutes: number|null;
  severity: 'info'|'urgent'; enabled: boolean }
type Fire = { ruleId: string; kind: 'arrived'|'ok'|'missed'|'seen'|'lingering'; title: string; severity: 'info'|'urgent' }
localTime(ms: number, tz: string): { date: string; dow: number; hm: string }
inWindow(rule: Rule, lt: LocalTime): boolean
onMatch(rule: Rule, at: number, tz: string, lastFire: { at: number; date: string } | null): Fire | null
onTick(rule: Rule, now: number, tz: string, firedToday: boolean, matchedInWindowToday: boolean): Fire | null
durationDue(rule: Rule, ep: { opened_at: number; alerted: boolean; closed_at: number|null }, now: number): Fire | null
```

Semantics: `start=null` → 00:00, `end=null` → 24:00; `start > end` is overnight (`hm >= start || hm < end`). `days` empty = every day. arrival/deadline: at most one fire per rule per local date. window: at most one fire per 10 min. Deadline "missed" fires on the first tick with `hm >= end` on an active day when nothing matched inside the window today.

- [ ] Write tests (vitest) covering: arrival inside/outside window; arrival once per day; window 10-min dedupe; overnight window match at 01:00; weekday-only rule ignored on Saturday; deadline missed at 16:00 when no match; deadline not fired when matched at 15:10; deadline missed when only match was at 13:00 (before window); deadline fires once across repeated ticks; duration due after `minutes`, not before, not twice, not after close; tz `America/Los_Angeles` vs `Asia/Kolkata` produce different local dates for the same instant.
- [ ] Run `pnpm vitest run worker/engine.test.ts` → FAIL.
- [ ] Implement `engine.ts` (Intl.DateTimeFormat with `timeZone`, `hourCycle: 'h23'`).
- [ ] Run → PASS. Commit `feat: rule engine`.

### Task 3: Bedrock client — compile + evaluate + budget

**Files:** `worker/ai.ts`, `worker/ai.test.ts`

**Produces:**
```ts
converse(env, body): Promise<{ text: string; usage: {inputTokens:number; outputTokens:number} }>
compileRules(env, text: string, tz: string): Promise<Omit<Rule,'id'|'enabled'>[]>   // throws CompileError on bad output after 1 retry
evaluateFrame(env, image: Uint8Array, rules: Rule[]): Promise<{ caption: string; matches: { ruleId: string; match: boolean; confidence: number; reason: string }[] }>
parseEvaluation(raw: string, ruleIds: string[]): same result shape   // pure, exported for tests
takeBudget(env, day: string): Promise<boolean>   // atomically increments usage, false if >= 300
```

- Endpoint: `POST https://bedrock-runtime.${AWS_REGION}.amazonaws.com/model/${MODEL_ID}/converse`, signed with `new AwsClient({accessKeyId, secretAccessKey, region, service:'bedrock'})`. `MODEL_ID` var (verify exact Nova 2 Lite inference-profile id with `aws bedrock list-inference-profiles` during AWS setup). `inferenceConfig: {maxTokens: 400, temperature: 0}`.
- Compile prompt: system instructs JSON array output matching Rule fields, `look_for` must be visual and never identify a person, one sentence may yield two rules (arrival + deadline), times as `HH:MM` 24h. Output parsed by extracting the first `[...]` block and validated field-by-field.
- Evaluate prompt: image + numbered rules `{id, look_for}`; reply `{"caption": "...", "matches":[{"id","match","confidence","reason"}]}`; never identify people.
- [ ] Tests for `parseEvaluation`: fenced ```json block parses; unknown rule ids dropped; missing rules default to `match:false`; garbage → `{caption:'', matches:[]}` (no throw); confidence clamped 0–1.
- [ ] Implement; tests pass. Commit `feat: bedrock compile/evaluate`.

### Task 4: Ring client, webhook, pipeline

**Files:** `worker/hmac.ts`, `worker/hmac.test.ts`, `worker/ring.ts`, `worker/db.ts`, `worker/pipeline.ts`, `worker/alerts.ts`, `worker/index.ts`

**Produces:**
```ts
signBody(key: string, raw: string): Promise<string>          // "sha256=<hex>"
verifySignature(key: string, raw: string, header: string|null): Promise<boolean>   // constant-time
ring.listDevices(token), ring.history(token, deviceId), ring.snapshot(token, deviceId, atMs): Promise<Uint8Array|null>
processEvent(env, eventId: string): Promise<void>
tick(env, now: number): Promise<void>
```

- [ ] hmac tests: round trip; wrong key false; missing header false; body with one changed byte false. Implement with WebCrypto.
- [ ] `POST /ring/webhook`: read raw text → verify → parse → `INSERT OR IGNORE` on `request_id` (duplicate → 200 `{status:'duplicate'}`) → `ctx.waitUntil(processEvent)` → 200. Only `motion_detected` and `button_press` are processed; others stored with status `ignored`.
- [ ] `processEvent`: frame = R2 `frames/<id>.jpg` (feeder pre-uploads) else `ring.snapshot(...)` stored to R2, else status `no_image`. If no active rules → status `done`. `takeBudget` false → `unanalyzed`. Else `evaluateFrame` → write matches + caption → for each matched rule `onMatch` (lastFire from `alerts`) → `alerts.fire`; duration rules: matched → open/refresh episode, not matched → close open episode. Bedrock throw → `unanalyzed`.
- [ ] `tick`: deadline `onTick` per rule; `durationDue` per open episode; retry up to 5 `unanalyzed` events.
- [ ] `alerts.fire`: insert row (with `local_date`), send email via Cloudflare Email binding if `settings.email` set; failures logged, never thrown.
- [ ] Integration test via `wrangler dev` + `scripts/feed.ts`: same signed payload twice → one event row; bad signature → 401.
- [ ] Commit `feat: ring webhook pipeline`.

### Task 5: API for the UI

**Files:** `worker/index.ts`, `worker/db.ts`

Routes (all `/api/*` require cookie `ww=<APP_TOKEN>`; `POST /api/login {token}` sets it):
`GET/POST /api/settings` (tz, email, ring_token, device_id) · `POST /api/rules/compile {text}` → drafts · `POST /api/rules` (save confirmed drafts) · `GET /api/rules` · `PATCH/DELETE /api/rules/:id` · `GET /api/events?date=` (with matches) · `GET /api/alerts?since=` · `GET /api/frames/:id` (R2 stream) · `GET /api/ring/devices` · `POST /api/demo/event {scene, type, sub_type, at?}` (copies scene to R2 then posts a signed webhook to itself) · `POST /api/demo/tick {at}`.

- [ ] Implement; smoke with curl. Commit `feat: api`.

### Task 6: UI

**Files:** `src/*`

Pages: **Rules** (hero textbox "What should I watch for?", example chips per persona, compile → draft cards showing summary + kind badge + time chips → Save), **Today** (vertical timeline: snapshot, time, caption, matched-rule badges, alert markers), **Alerts** (live list, polled every 3 s, urgent in red), **Settings** (Ring token + device picker with live status, email, time zone), **Demo** (scene picker grid, event type, scene time, "Send event", "Run clock to…"). Design: calm dark-first UI, one accent color, large type; responsive.

- [ ] Build pages against the API. Commit `feat: ui`.

### Task 7: Scenes, eval, deploy

- [ ] Create ~8 scene images in `public/scenes/` (kids with backpacks at door, empty porch, package on porch, delivery van, cleaner with supplies leaving, person at night, guest with suitcase, line outside a shop) via gpt-image-2 **quality=low**, plus Playground stream frames if snapshots work.
- [ ] `scripts/eval.ts`: run each scene × relevant rule through `evaluateFrame`, print accuracy; target ≥ 90% before recording.
- [ ] AWS: IAM user `watchword-bedrock` with only `bedrock:InvokeModel` on Nova 2 Lite; Budgets alert $3. Secrets via `wrangler secret put`: `APP_TOKEN`, `RING_HMAC_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- [ ] `wrangler d1 migrations apply --remote`, `pnpm run deploy`; verify end-to-end on the deployed URL.
- [ ] README (what/why, architecture diagram, setup, Ring Playground steps, AWS Builder section, costs), friction log entries, commit, push public repo.

### Task 8: Submission

- [ ] Record video (parent → host → shop, < 3 min), upload to YouTube.
- [ ] Devpost form: description, repo, video, Ring + AWS Builder, product feedback, friction log.
