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

CREATE TABLE IF NOT EXISTS amrp_status_incidents (
  id BIGSERIAL PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES amrp_status_services(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('degraded', 'down', 'maintenance')),
  reason TEXT NOT NULL,
  started_at DOUBLE PRECISION NOT NULL,
  resolved_at DOUBLE PRECISION,
  resolution TEXT
);

CREATE TABLE IF NOT EXISTS amrp_status_monitor (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  last_successful_at DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS amrp_status_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notice' CHECK (kind IN ('outage', 'notice')),
  affected_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  published SMALLINT NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  published_at DOUBLE PRECISION,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS amrp_status_services_enabled_category_idx ON amrp_status_services (enabled, category, name);
CREATE INDEX IF NOT EXISTS amrp_status_history_checked_at_idx ON amrp_status_history (checked_at);
CREATE UNIQUE INDEX IF NOT EXISTS amrp_status_incidents_open_service_idx ON amrp_status_incidents (service_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS amrp_status_incidents_started_at_idx ON amrp_status_incidents (started_at DESC);
CREATE INDEX IF NOT EXISTS amrp_status_announcements_published_idx ON amrp_status_announcements (published, published_at DESC);
CREATE TABLE IF NOT EXISTS amrp_status_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL);
