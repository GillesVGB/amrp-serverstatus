import { assertDatabaseAvailable, clearDatabaseUnavailable, markDatabaseUnavailable } from "./database-availability";
import { createDatabaseClient, type DatabaseClient } from "./database-client";

export type ServiceKind = "fivem" | "website" | "http";
export type ServiceStatus = "operational" | "degraded" | "down" | "unknown" | "maintenance";
export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  kind: ServiceKind;
  endpoint: string;
  enabled: number;
  paused: number;
  maintenance: number;
  maintenanceMessage: string;
};

export const DEFAULT_SERVICES: ServiceRow[] = [
  { id: "fivem-main", name: "Main Game Server", category: "FiveM servers", kind: "fivem", endpoint: "http://185.229.35.13:30120/dynamic.json", enabled: 1, paused: 0, maintenance: 0, maintenanceMessage: "" },
  { id: "fivem-dev", name: "Dev Game Server", category: "FiveM servers", kind: "fivem", endpoint: "http://185.229.35.13:30121/dynamic.json", enabled: 1, paused: 0, maintenance: 0, maintenanceMessage: "" },
  { id: "amsterdam-bot", name: "Discord Bot", category: "Diensten", kind: "http", endpoint: "http://185.229.35.13:3001/", enabled: 1, paused: 0, maintenance: 0, maintenanceMessage: "" },
  { id: "meos", name: "MEOS", category: "Websites", kind: "website", endpoint: "https://meos.amsterdamrp.nl/", enabled: 1, paused: 0, maintenance: 0, maintenanceMessage: "" },
  { id: "overheid", name: "Overheidsportaal", category: "Websites", kind: "website", endpoint: "https://overheid.amsterdamrp.nl/", enabled: 1, paused: 0, maintenance: 0, maintenanceMessage: "" },
];

type HistoryRow = { status: ServiceStatus; checkedAt: number; message: string };
export type IncidentRow = { id: number; serviceId: string; serviceName: string; status: ServiceStatus; reason: string; startedAt: number; resolvedAt: number | null };
export type IncidentChange = { kind: "started" | "updated" | "recovered"; previousStatus?: ServiceStatus; incident: IncidentRow };
export type AnnouncementService = { id: string; name: string };
export type AnnouncementKind = "outage" | "notice";
export type AnnouncementRow = { id: string; title: string; description: string; kind: AnnouncementKind; affectedServices: AnnouncementService[]; published: boolean; publishedAt: number | null; createdAt: number; updatedAt: number };
export type AnnouncementInput = Omit<AnnouncementRow, "id" | "publishedAt" | "createdAt" | "updatedAt">;
export type SiteSettings = { maintenance: boolean; reason: string; updatedAt: number | null };
let memoryServices: ServiceRow[] = DEFAULT_SERVICES.map((service) => ({ ...service }));
const memoryHistory = new Map<string, HistoryRow[]>();
const memoryIncidents = new Map<string, IncidentRow>();
const memoryIncidentHistory: IncidentRow[] = [];
const memoryAnnouncements: AnnouncementRow[] = [];
let memorySiteSettings: SiteSettings = { maintenance: false, reason: "", updatedAt: null };
let memoryMonitorHeartbeat: number | null = null;
let schemaSetup: Promise<void> | undefined;
let sqlSetup: Promise<DatabaseClient> | undefined;
let siteSettingsRead: Promise<SiteSettings> | undefined;
let lastPrunedAt = 0;

function databaseUrl() {
  return process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

async function sqlClient() {
  assertDatabaseAvailable();
  const url = databaseUrl();
  if (!url) throw new Error("Stel eerst de PostgreSQL-database in bij de hostingvariabelen.");
  sqlSetup ??= createDatabaseClient(url).catch((error) => {
    sqlSetup = undefined;
    throw error;
  });
  return sqlSetup;
}

async function ensureSchema() {
  if (!databaseUrl()) return;
  if (!schemaSetup) {
    schemaSetup = (async () => {
      const sql = await sqlClient();
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_services (
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
      )`;
      await sql`ALTER TABLE amrp_status_services ADD COLUMN IF NOT EXISTS maintenance SMALLINT NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE amrp_status_services ADD COLUMN IF NOT EXISTS paused SMALLINT NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))`;
      await sql`UPDATE amrp_status_services SET paused = 1 WHERE enabled = 0 AND paused = 0`;
      await sql`ALTER TABLE amrp_status_services ADD COLUMN IF NOT EXISTS maintenance_message TEXT NOT NULL DEFAULT ''`;
      await sql`CREATE INDEX IF NOT EXISTS amrp_status_services_enabled_category_idx ON amrp_status_services (enabled, category, name)`;
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_history (
        service_id TEXT NOT NULL REFERENCES amrp_status_services(id) ON DELETE CASCADE,
        bucket BIGINT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'down', 'unknown', 'maintenance')),
        checked_at DOUBLE PRECISION NOT NULL,
        response_ms INTEGER,
        message TEXT NOT NULL,
        players INTEGER,
        max_players INTEGER,
        PRIMARY KEY (service_id, bucket)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS amrp_status_history_checked_at_idx ON amrp_status_history (checked_at)`;
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_incidents (
        id BIGSERIAL PRIMARY KEY,
        service_id TEXT NOT NULL REFERENCES amrp_status_services(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('degraded', 'down', 'maintenance')),
        reason TEXT NOT NULL,
        started_at DOUBLE PRECISION NOT NULL,
        resolved_at DOUBLE PRECISION,
        resolution TEXT
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS amrp_status_incidents_open_service_idx ON amrp_status_incidents (service_id) WHERE resolved_at IS NULL`;
      await sql`CREATE INDEX IF NOT EXISTS amrp_status_incidents_started_at_idx ON amrp_status_incidents (started_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_monitor (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        last_successful_at DOUBLE PRECISION NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_announcements (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'notice' CHECK (kind IN ('outage', 'notice')),
        affected_services JSONB NOT NULL DEFAULT '[]'::jsonb,
        published SMALLINT NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
        published_at DOUBLE PRECISION,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`ALTER TABLE amrp_status_announcements ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'notice' CHECK (kind IN ('outage', 'notice'))`;
      await sql`CREATE INDEX IF NOT EXISTS amrp_status_announcements_published_idx ON amrp_status_announcements (published, published_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_site_settings (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        maintenance SMALLINT NOT NULL DEFAULT 0 CHECK (maintenance IN (0, 1)),
        updated_at BIGINT NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`;
      await sql`ALTER TABLE amrp_status_site_settings ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT ''`;
      // Only the server-side table owner accesses these tables. No public
      // Supabase Data API policies expose endpoints, drafts or settings.
      await sql`ALTER TABLE amrp_status_services ENABLE ROW LEVEL SECURITY`;
      await sql`ALTER TABLE amrp_status_history ENABLE ROW LEVEL SECURITY`;
      await sql`ALTER TABLE amrp_status_incidents ENABLE ROW LEVEL SECURITY`;
      await sql`ALTER TABLE amrp_status_monitor ENABLE ROW LEVEL SECURITY`;
      await sql`ALTER TABLE amrp_status_announcements ENABLE ROW LEVEL SECURITY`;
      await sql`ALTER TABLE amrp_status_site_settings ENABLE ROW LEVEL SECURITY`;
      await sql`ALTER TABLE amrp_status_migrations ENABLE ROW LEVEL SECURITY`;
    })().catch((error) => {
      schemaSetup = undefined;
      throw markDatabaseUnavailable(error);
    });
  }
  await schemaSetup;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (!databaseUrl()) return { ...memorySiteSettings };
  siteSettingsRead ??= (async () => {
    try {
      await ensureSchema();
      const sql = await sqlClient();
      const rows = await sql`SELECT maintenance, reason, updated_at AS "updatedAt" FROM amrp_status_site_settings WHERE id = 1`;
      const row = rows[0];
      const settings = row
        ? { maintenance: Number(row.maintenance) === 1, reason: String(row.reason || ""), updatedAt: Number(row.updatedAt) }
        : { maintenance: false, reason: "", updatedAt: null };
      clearDatabaseUnavailable();
      return settings;
    } catch (error) {
      throw markDatabaseUnavailable(error);
    }
  })().finally(() => {
    siteSettingsRead = undefined;
  });
  return { ...await siteSettingsRead };
}

export async function saveSiteSettings(maintenance: boolean, reason = ""): Promise<SiteSettings> {
  if (typeof maintenance !== "boolean") throw new Error("Ongeldige onderhoudsinstelling.");
  reason = reason.trim();
  if (reason.length > 500 || (maintenance && reason.length < 5)) throw new Error("Vul een onderhoudsreden in van 5 tot 500 tekens.");
  const updatedAt = Date.now();
  if (!databaseUrl()) {
    memorySiteSettings = { maintenance, reason, updatedAt };
    return { ...memorySiteSettings };
  }
  await ensureSchema();
  const sql = await sqlClient();
  const rows = await sql`INSERT INTO amrp_status_site_settings (id, maintenance, reason, updated_at)
    VALUES (1, ${maintenance ? 1 : 0}, ${reason}, ${updatedAt})
    ON CONFLICT (id) DO UPDATE SET maintenance = EXCLUDED.maintenance, reason = EXCLUDED.reason, updated_at = EXCLUDED.updated_at
    RETURNING maintenance, reason, updated_at AS "updatedAt"`;
  const row = rows[0];
  if (!row) throw new Error("De website-instellingen konden niet worden opgeslagen.");
  return { maintenance: Number(row.maintenance) === 1, reason: String(row.reason || ""), updatedAt: Number(row.updatedAt) };
}

export async function ensureSeeded() {
  if (!databaseUrl()) return;
  await ensureSchema();
  const sql = await sqlClient();
  const migrations = await sql`SELECT version FROM amrp_status_migrations WHERE version IN ('initial-services-v1', 'dev-server-v1')`;
  const applied = new Set(migrations.map((row) => String(row.version)));
  const now = Date.now();
  if (!applied.has("initial-services-v1")) {
    const existing = await sql`SELECT id FROM amrp_status_services LIMIT 1`;
    if (!existing.length) {
      for (const service of DEFAULT_SERVICES.filter((item) => item.id !== "fivem-dev")) {
        await sql.query(
          "INSERT INTO amrp_status_services (id, name, category, kind, endpoint, enabled, paused, maintenance, maintenance_message, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) ON CONFLICT (id) DO NOTHING",
          [service.id, service.name, service.category, service.kind, service.endpoint, service.enabled, service.paused, service.maintenance, service.maintenanceMessage, now],
        );
      }
    }
    await sql`INSERT INTO amrp_status_migrations (version, applied_at) VALUES ('initial-services-v1', ${now}) ON CONFLICT (version) DO NOTHING`;
  }
  if (!applied.has("dev-server-v1")) {
    const service = DEFAULT_SERVICES.find((item) => item.id === "fivem-dev");
    if (service) {
      await sql.query(
        "INSERT INTO amrp_status_services (id, name, category, kind, endpoint, enabled, paused, maintenance, maintenance_message, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) ON CONFLICT (id) DO NOTHING",
        [service.id, service.name, service.category, service.kind, service.endpoint, service.enabled, service.paused, service.maintenance, service.maintenanceMessage, now],
      );
    }
    await sql`INSERT INTO amrp_status_migrations (version, applied_at) VALUES ('dev-server-v1', ${now}) ON CONFLICT (version) DO NOTHING`;
  }
}

export async function listServices(includeDisabled = false) {
  await ensureSeeded();
  if (!databaseUrl()) return memoryServices.filter((service) => includeDisabled || service.enabled === 1).map((service) => ({ ...service }));
  const sql = await sqlClient();
  const rows = includeDisabled
    ? await sql`SELECT id, name, category, kind, endpoint, enabled, paused, maintenance, maintenance_message AS "maintenanceMessage" FROM amrp_status_services ORDER BY category, name`
    : await sql`SELECT id, name, category, kind, endpoint, enabled, paused, maintenance, maintenance_message AS "maintenanceMessage" FROM amrp_status_services WHERE enabled = 1 ORDER BY category, name`;
  return rows.map((row) => ({ ...row, enabled: Number(row.enabled), paused: Number(row.paused), maintenance: Number(row.maintenance) })) as ServiceRow[];
}

export async function adminDatabase() {
  await ensureSchema();
  return sqlClient();
}

export async function saveService(service: Omit<ServiceRow, "id">, id = crypto.randomUUID()) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const now = Date.now();
    await sql.query(
      "INSERT INTO amrp_status_services (id, name, category, kind, endpoint, enabled, paused, maintenance, maintenance_message, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, kind = EXCLUDED.kind, endpoint = EXCLUDED.endpoint, enabled = EXCLUDED.enabled, paused = EXCLUDED.paused, maintenance = EXCLUDED.maintenance, maintenance_message = EXCLUDED.maintenance_message, updated_at = EXCLUDED.updated_at",
      [id, service.name, service.category, service.kind, service.endpoint, service.enabled, service.paused, service.maintenance, service.maintenanceMessage, now],
    );
  } else if (memoryServices.some((item) => item.id === id)) {
    memoryServices = memoryServices.map((item) => item.id === id ? { id, ...service } : item);
  } else {
    memoryServices = [...memoryServices, { id, ...service }];
  }
  return { id, ...service };
}

export async function deleteService(id: string) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const existing = await sql`SELECT id FROM amrp_status_services WHERE id = ${id}`;
    if (!existing.length) return false;
    await sql`DELETE FROM amrp_status_services WHERE id = ${id}`;
    return true;
  }
  const oldLength = memoryServices.length;
  memoryServices = memoryServices.filter((service) => service.id !== id);
  memoryHistory.delete(id);
  return oldLength !== memoryServices.length;
}

export async function recordHistory(id: string, bucket: number, checkedAt: number, result: { status: ServiceStatus; responseMs: number | null; message: string; players: number | null; maxPlayers: number | null }) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    await sql.query(
      "INSERT INTO amrp_status_history (service_id, bucket, status, checked_at, response_ms, message, players, max_players) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (service_id, bucket) DO NOTHING",
      [id, bucket, result.status, checkedAt, result.responseMs, result.message, result.players, result.maxPlayers],
    );
    return;
  }
  const samples = memoryHistory.get(id) ?? [];
  if (samples.some(sample => Math.floor(sample.checkedAt / 60_000) === bucket)) return;
  const next = samples.filter(sample => sample.checkedAt >= checkedAt - 86_400_000);
  next.push({ status: result.status, checkedAt, message: result.message });
  next.sort((a, b) => a.checkedAt - b.checkedAt);
  const trimmed = next.slice(-1440);
  memoryHistory.set(id, trimmed);
}

export type HistoryRange = "1h" | "12h" | "24h";
const HISTORY_RANGES: Record<HistoryRange, { duration: number; bins: number }> = {
  "1h": { duration: 60 * 60 * 1000, bins: 60 },
  "12h": { duration: 12 * 60 * 60 * 1000, bins: 720 },
  "24h": { duration: 24 * 60 * 60 * 1000, bins: 1440 },
};
const statusPriority: Record<ServiceStatus, number> = { operational: 0, unknown: 1, maintenance: 2, degraded: 3, down: 4 };

export async function getHistory(id: string, range: HistoryRange, now: number): Promise<(HistoryRow | null)[]> {
  const { duration, bins } = HISTORY_RANGES[range];
  const start = now - duration;
  const bucketSize = duration / bins;
  const result: (HistoryRow | null)[] = Array.from({ length: bins }, () => null);
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const rows = await sql.query(
      `SELECT LEAST($5 - 1, FLOOR((checked_at - $1) / $2))::INTEGER AS bin,
        (ARRAY_AGG(status ORDER BY CASE status WHEN 'down' THEN 4 WHEN 'degraded' THEN 3 WHEN 'maintenance' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END DESC, checked_at DESC))[1] AS status,
        (ARRAY_AGG(checked_at ORDER BY CASE status WHEN 'down' THEN 4 WHEN 'degraded' THEN 3 WHEN 'maintenance' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END DESC, checked_at DESC))[1] AS "checkedAt",
        (ARRAY_AGG(message ORDER BY CASE status WHEN 'down' THEN 4 WHEN 'degraded' THEN 3 WHEN 'maintenance' THEN 2 WHEN 'unknown' THEN 1 ELSE 0 END DESC, checked_at DESC))[1] AS message
       FROM amrp_status_history WHERE service_id = $3 AND checked_at >= $1 AND checked_at <= $4
       GROUP BY LEAST($5 - 1, FLOOR((checked_at - $1) / $2)) ORDER BY bin`,
      [start, bucketSize, id, now, bins],
    );
    for (const row of rows) {
      const index = Number(row.bin);
      if (index >= 0 && index < bins) result[index] = { status: row.status as ServiceStatus, checkedAt: Number(row.checkedAt), message: String(row.message ?? "") };
    }
    return result;
  }
  for (const sample of memoryHistory.get(id) ?? []) {
    if (sample.checkedAt < start || sample.checkedAt > now) continue;
    const index = Math.min(bins - 1, Math.floor((sample.checkedAt - start) / bucketSize));
    const current = result[index];
    if (!current || statusPriority[sample.status] > statusPriority[current.status] || (statusPriority[sample.status] === statusPriority[current.status] && sample.checkedAt > current.checkedAt)) result[index] = sample;
  }
  return result;
}

export async function recordIncidentState(service: Pick<ServiceRow, "id" | "name">, status: ServiceStatus, reason: string, checkedAt: number): Promise<IncidentChange | null> {
  if (status === "unknown") return null;
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    if (status === "operational") {
      const rows = await sql.query(
        `UPDATE amrp_status_incidents SET resolved_at = $2, resolution = 'De dienst is weer operationeel.'
         WHERE service_id = $1 AND resolved_at IS NULL RETURNING id, service_id AS "serviceId", status, reason, started_at AS "startedAt", resolved_at AS "resolvedAt"`,
        [service.id, checkedAt],
      );
      const row = rows[0];
      return row ? { kind: "recovered", incident: { ...row, id: Number(row.id), serviceId: String(row.serviceId), serviceName: service.name, status: row.status as ServiceStatus, reason: String(row.reason), startedAt: Number(row.startedAt), resolvedAt: Number(row.resolvedAt) } } : null;
    }
    const inserted = await sql.query(
      `INSERT INTO amrp_status_incidents (service_id, status, reason, started_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (service_id) WHERE resolved_at IS NULL DO NOTHING
       RETURNING id, service_id AS "serviceId", status, reason, started_at AS "startedAt", resolved_at AS "resolvedAt"`,
      [service.id, status, reason, checkedAt],
    );
    if (inserted[0]) {
      const row = inserted[0];
      return { kind: "started", incident: { ...row, id: Number(row.id), serviceId: String(row.serviceId), serviceName: service.name, status: row.status as ServiceStatus, reason: String(row.reason), startedAt: Number(row.startedAt), resolvedAt: null } };
    }
    const existing = await sql`SELECT id, service_id AS "serviceId", status, reason, started_at AS "startedAt", resolved_at AS "resolvedAt" FROM amrp_status_incidents WHERE service_id = ${service.id} AND resolved_at IS NULL LIMIT 1`;
    const old = existing[0];
    if (!old || (old.status === status && old.reason === reason)) return null;
    const updated = await sql.query(
      `UPDATE amrp_status_incidents SET status = $2, reason = $3 WHERE id = $1 AND resolved_at IS NULL AND status = $4
       RETURNING id, service_id AS "serviceId", status, reason, started_at AS "startedAt", resolved_at AS "resolvedAt"`,
      [old.id, status, reason, old.status],
    );
    const row = updated[0];
    return row ? { kind: "updated", previousStatus: old.status as ServiceStatus, incident: { ...row, id: Number(row.id), serviceId: String(row.serviceId), serviceName: service.name, status: row.status as ServiceStatus, reason: String(row.reason), startedAt: Number(row.startedAt), resolvedAt: null } } : null;
  }
  const existing = memoryIncidents.get(service.id);
  if (status === "operational") {
    if (!existing) return null;
    const incident = { ...existing, resolvedAt: checkedAt };
    memoryIncidents.delete(service.id);
    const index = memoryIncidentHistory.findIndex((item) => item.id === existing.id);
    if (index >= 0) memoryIncidentHistory[index] = incident;
    return { kind: "recovered", incident };
  }
  if (!existing) {
    const incident = { id: checkedAt, serviceId: service.id, serviceName: service.name, status, reason, startedAt: checkedAt, resolvedAt: null };
    memoryIncidents.set(service.id, incident);
    memoryIncidentHistory.unshift(incident);
    return { kind: "started", incident };
  }
  if (existing.status === status) {
    existing.reason = reason;
    return null;
  }
  const previousStatus = existing.status;
  const incident = { ...existing, status, reason };
  memoryIncidents.set(service.id, incident);
  const index = memoryIncidentHistory.findIndex((item) => item.id === existing.id);
  if (index >= 0) memoryIncidentHistory[index] = incident;
  return { kind: "updated", previousStatus, incident };
}

export async function listIncidents(limit = 20): Promise<IncidentRow[]> {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const rows = await sql.query(
      `SELECT i.id, i.service_id AS "serviceId", COALESCE(s.name, i.service_id) AS "serviceName", i.status, i.reason,
        i.started_at AS "startedAt", i.resolved_at AS "resolvedAt"
       FROM (
         SELECT * FROM amrp_status_incidents WHERE resolved_at IS NULL
         UNION ALL
         SELECT * FROM (
           SELECT * FROM amrp_status_incidents WHERE resolved_at IS NOT NULL ORDER BY started_at DESC LIMIT $1
         ) recent_resolved
       ) i LEFT JOIN amrp_status_services s ON s.id = i.service_id
       ORDER BY i.started_at DESC`, [limit],
    );
    return rows.map((row) => ({ id: Number(row.id), serviceId: String(row.serviceId), serviceName: String(row.serviceName), status: row.status as ServiceStatus, reason: String(row.reason), startedAt: Number(row.startedAt), resolvedAt: row.resolvedAt === null ? null : Number(row.resolvedAt) }));
  }
  const active = memoryIncidentHistory.filter((incident) => incident.resolvedAt === null);
  const resolved = memoryIncidentHistory.filter((incident) => incident.resolvedAt !== null).slice(0, limit);
  return [...active, ...resolved].sort((left, right) => right.startedAt - left.startedAt);
}

function parseAnnouncementServices(value: unknown): AnnouncementService[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): AnnouncementService[] => {
    if (!item || typeof item !== "object") return [];
    const service = item as Record<string, unknown>;
    const id = String(service.id ?? "").trim();
    const name = String(service.name ?? "").trim();
    return id && name ? [{ id, name }] : [];
  });
}

export async function listAnnouncements(includeUnpublished = false): Promise<AnnouncementRow[]> {
  if (!databaseUrl()) {
    return memoryAnnouncements
      .filter((announcement) => includeUnpublished || announcement.published)
      .map((announcement) => ({ ...announcement, affectedServices: announcement.affectedServices.map((service) => ({ ...service })) }))
      .sort((left, right) => (right.publishedAt ?? right.updatedAt) - (left.publishedAt ?? left.updatedAt));
  }
  await ensureSchema();
  const sql = await sqlClient();
  const rows = includeUnpublished
    ? await sql`SELECT id, title, description, kind, affected_services AS "affectedServices", published, published_at AS "publishedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM amrp_status_announcements ORDER BY COALESCE(published_at, updated_at) DESC`
    : await sql`SELECT id, title, description, kind, affected_services AS "affectedServices", published, published_at AS "publishedAt", created_at AS "createdAt", updated_at AS "updatedAt" FROM amrp_status_announcements WHERE published = 1 ORDER BY published_at DESC`;
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    kind: row.kind === "outage" ? "outage" : "notice",
    affectedServices: parseAnnouncementServices(row.affectedServices),
    published: Number(row.published) === 1,
    publishedAt: row.publishedAt === null ? null : Number(row.publishedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }));
}

export async function saveAnnouncement(input: AnnouncementInput, id?: string): Promise<AnnouncementRow | null> {
  const now = Date.now();
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const existing = id ? await sql`SELECT published_at AS "publishedAt" FROM amrp_status_announcements WHERE id = ${id}` : [];
    if (id && !existing.length) return null;
    const savedId = id ?? crypto.randomUUID();
    const publishedAt = input.published ? (existing[0]?.publishedAt === null || existing[0]?.publishedAt === undefined ? now : Number(existing[0].publishedAt)) : null;
    const rows = await sql.query(
      `INSERT INTO amrp_status_announcements (id, title, description, kind, affected_services, published, published_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $8)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, kind = EXCLUDED.kind, affected_services = EXCLUDED.affected_services,
         published = EXCLUDED.published, published_at = EXCLUDED.published_at, updated_at = EXCLUDED.updated_at
       RETURNING id, title, description, kind, affected_services AS "affectedServices", published, published_at AS "publishedAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [savedId, input.title, input.description, input.kind, JSON.stringify(input.affectedServices), input.published ? 1 : 0, publishedAt, now],
    );
    const row = rows[0];
    return row ? { id: String(row.id), title: String(row.title), description: String(row.description), kind: row.kind === "outage" ? "outage" : "notice", affectedServices: parseAnnouncementServices(row.affectedServices), published: Number(row.published) === 1, publishedAt: row.publishedAt === null ? null : Number(row.publishedAt), createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt) } : null;
  }
  const existing = id ? memoryAnnouncements.find((announcement) => announcement.id === id) : undefined;
  if (id && !existing) return null;
  const saved: AnnouncementRow = {
    id: id ?? crypto.randomUUID(),
    ...input,
    affectedServices: input.affectedServices.map((service) => ({ ...service })),
    publishedAt: input.published ? existing?.publishedAt ?? now : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (existing) memoryAnnouncements.splice(memoryAnnouncements.indexOf(existing), 1, saved);
  else memoryAnnouncements.unshift(saved);
  return saved;
}

export async function deleteAnnouncement(id: string) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const rows = await sql`DELETE FROM amrp_status_announcements WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }
  const index = memoryAnnouncements.findIndex((announcement) => announcement.id === id);
  if (index < 0) return false;
  memoryAnnouncements.splice(index, 1);
  return true;
}

export async function pruneHistory(before: number) {
  if (Date.now() - lastPrunedAt < 300_000) return;
  lastPrunedAt = Date.now();
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    await sql`DELETE FROM amrp_status_history WHERE checked_at < ${before}`;
    return;
  }
  for (const [id, history] of memoryHistory) memoryHistory.set(id, history.filter((sample) => sample.checkedAt >= before));
}

export async function recordMonitorHeartbeat(checkedAt: number) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    await sql`INSERT INTO amrp_status_monitor (id, last_successful_at) VALUES (1, ${checkedAt}) ON CONFLICT (id) DO UPDATE SET last_successful_at = EXCLUDED.last_successful_at`;
    return;
  }
  memoryMonitorHeartbeat = checkedAt;
}

export async function getMonitorHeartbeat(): Promise<number | null> {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const rows = await sql`SELECT last_successful_at FROM amrp_status_monitor WHERE id = 1`;
    return rows.length ? Number(rows[0].last_successful_at) : null;
  }
  return memoryMonitorHeartbeat;
}

export function validateService(input: unknown): Omit<ServiceRow, "id"> {
  if (!input || typeof input !== "object") throw new Error("Vul de dienstgegevens in.");
  const value = input as Record<string, unknown>;
  const name = String(value.name ?? "").trim();
  const category = String(value.category ?? "").trim();
  const endpoint = String(value.endpoint ?? "").trim();
  const maintenanceMessage = String(value.maintenanceMessage ?? "").trim().slice(0, 220);
  const kind = value.kind;
  if (!name || name.length > 70) throw new Error("De naam moet 1 tot 70 tekens bevatten.");
  if (!category || category.length > 45) throw new Error("De categorie moet 1 tot 45 tekens bevatten.");
  if (kind !== "fivem" && kind !== "website" && kind !== "http") throw new Error("Kies een geldige controlemethode.");
  if (endpoint.length > 500) throw new Error("Het adres is te lang.");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Vul een volledig adres in, inclusief http:// of https://."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Alleen HTTP- en HTTPS-adressen zijn toegestaan.");
  if (url.username || url.password) throw new Error("Adressen met een gebruikersnaam of wachtwoord zijn niet toegestaan.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname === "metadata.google.internal") {
    throw new Error("Lokale adressen zijn niet toegestaan.");
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, c] = ipv4.slice(1).map(Number);
    const reserved = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2 || c === 113)) || (b === 88 && c === 99) || (b === 51 && c === 100))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113) || (a === 100 && b >= 64 && b <= 127);
    if (ipv4.slice(1).some((part) => Number(part) > 255) || reserved) {
      throw new Error("Privé- en lokale IP-adressen zijn niet toegestaan.");
    }
  }
  if (hostname.includes(":")) throw new Error("IPv6-adressen worden voor deze controle niet ondersteund.");
  return {
    name,
    category,
    kind,
    endpoint: url.toString(),
    enabled: value.enabled === false || value.enabled === 0 ? 0 : 1,
    paused: value.paused === true || value.paused === 1 ? 1 : 0,
    maintenance: value.maintenance === true || value.maintenance === 1 ? 1 : 0,
    maintenanceMessage,
  };
}

export function validateAnnouncement(input: unknown): Omit<AnnouncementInput, "affectedServices"> & { serviceIds: string[] } {
  if (!input || typeof input !== "object") throw new Error("Vul de meldinggegevens in.");
  const value = input as Record<string, unknown>;
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const kind = value.kind === undefined ? "notice" : value.kind;
  if (!title || title.length > 120) throw new Error("De titel moet 1 tot 120 tekens bevatten.");
  if (!description || description.length > 5000) throw new Error("De beschrijving moet 1 tot 5000 tekens bevatten.");
  if (kind !== "outage" && kind !== "notice") throw new Error("Kies storing of mededeling als type.");
  if (!Array.isArray(value.serviceIds) || value.serviceIds.length > 100 || value.serviceIds.some((serviceId) => typeof serviceId !== "string" || !serviceId.trim())) {
    throw new Error("Kies geldige getroffen diensten.");
  }
  return {
    title,
    description,
    kind,
    serviceIds: [...new Set(value.serviceIds.map((serviceId) => String(serviceId).trim()))],
    published: value.published === true,
  };
}

const encoder = new TextEncoder();
const fromHex = (text: string) => Uint8Array.from(text.match(/.{2}/g) ?? [], (pair) => parseInt(pair, 16));
const toBase64Url = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

export async function verifyAdminPassword(password: string) {
  const salt = process.env.ADMIN_PASSWORD_SALT;
  const expected = process.env.ADMIN_PASSWORD_HASH;
  if (!salt || !expected || !/^[a-f\d]{64}$/i.test(expected)) return false;
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 }, material, 256));
  const wanted = fromHex(expected);
  if (derived.length !== wanted.length) return false;
  let difference = 0;
  for (let i = 0; i < derived.length; i += 1) difference |= derived[i] ^ wanted[i];
  return difference === 0;
}

async function sessionKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("De beheersleutel ontbreekt in de hostinginstellingen.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createAdminCookie() {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ role: "beheerder", exp: Date.now() + 8 * 60 * 60 * 1000 })));
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", await sessionKey(), encoder.encode(payload))));
  return `${payload}.${signature}`;
}

export async function hasAdminSession(request: Request) {
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookie = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith("amrp_status_admin="))?.slice("amrp_status_admin=".length);
    if (!cookie) return false;
    const [payload, signature] = cookie.split(".");
    if (!payload || !signature || !await crypto.subtle.verify("HMAC", await sessionKey(), fromBase64Url(signature), encoder.encode(payload))) return false;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { role?: string; exp?: number };
    return data.role === "beheerder" && typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export const privateCookie = (value: string, maxAge: number, secure = true) => `amrp_status_admin=${value}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax; Max-Age=${maxAge}`;
