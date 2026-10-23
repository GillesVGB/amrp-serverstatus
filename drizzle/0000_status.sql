CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fivem', 'website', 'http')),
  endpoint TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS services_enabled_category_idx ON services (enabled, category, name);

CREATE TABLE IF NOT EXISTS status_history (
  service_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'down', 'unknown')),
  checked_at INTEGER NOT NULL,
  response_ms INTEGER,
  message TEXT NOT NULL,
  players INTEGER,
  max_players INTEGER,
  PRIMARY KEY (service_id, bucket),
  FOREIGN KEY (service_id) REFERENCES services (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS status_history_checked_at_idx ON status_history (checked_at);
