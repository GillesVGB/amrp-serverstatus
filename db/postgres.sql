-- Vercel + Neon schema. The app also applies these idempotently on first use.
CREATE TABLE IF NOT EXISTS amrp_status_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fivem', 'website', 'http')),
  endpoint TEXT NOT NULL,
  enabled SMALLINT NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  paused SMALLINT NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  maintenance SMALLINT NOT NULL DEFAULT 0 CHECK (maintenance IN (0, 1)),
  maintenance_message TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS amrp_status_history (
  service_id TEXT NOT NULL REFERENCES amrp_status_services(id) ON DELETE CASCADE,
  bucket BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'down', 'unknown', 'maintenance')),
  checked_at DOUBLE PRECISION NOT NULL,
  response_ms INTEGER,
  message TEXT NOT NULL,
  players INTEGER,
  max_players INTEGER,
  PRIMARY KEY (service_id, bucket)
);

CREATE INDEX IF NOT EXISTS amrp_status_services_enabled_category_idx ON amrp_status_services (enabled, category, name);
CREATE INDEX IF NOT EXISTS amrp_status_history_checked_at_idx ON amrp_status_history (checked_at);
CREATE TABLE IF NOT EXISTS amrp_status_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL);
