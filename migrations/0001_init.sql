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
