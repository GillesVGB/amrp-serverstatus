export type ServiceKind = "fivem" | "website" | "http";
export type ServiceStatus = "operational" | "degraded" | "down" | "unknown" | "maintenance";
export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  kind: ServiceKind;
  endpoint: string;
  enabled: number;
  maintenance: number;
  maintenanceMessage: string;
};

export const DEFAULT_SERVICES: ServiceRow[] = [
  { id: "fivem-main", name: "Main Game Server", category: "FiveM servers", kind: "fivem", endpoint: "http://185.229.35.13:30120/dynamic.json", enabled: 1, maintenance: 0, maintenanceMessage: "" },
  { id: "fivem-dev", name: "Dev Game Server", category: "FiveM servers", kind: "fivem", endpoint: "http://185.229.35.13:30121/dynamic.json", enabled: 1, maintenance: 0, maintenanceMessage: "" },
  { id: "amsterdam-bot", name: "Discord Bot", category: "Diensten", kind: "http", endpoint: "http://185.229.35.13:3001/", enabled: 1, maintenance: 0, maintenanceMessage: "" },
  { id: "meos", name: "MEOS", category: "Websites", kind: "website", endpoint: "https://meos.amsterdamrp.nl/", enabled: 1, maintenance: 0, maintenanceMessage: "" },
  { id: "overheid", name: "Overheidsportaal", category: "Websites", kind: "website", endpoint: "https://overheid.amsterdamrp.nl/", enabled: 1, maintenance: 0, maintenanceMessage: "" },
];

type HistoryRow = { status: ServiceStatus; checkedAt: number };
type NeonSql = import("@neondatabase/serverless").NeonQueryFunction<false, false>;
let memoryServices: ServiceRow[] = DEFAULT_SERVICES.map((service) => ({ ...service }));
const memoryHistory = new Map<string, HistoryRow[]>();
let schemaSetup: Promise<void> | undefined;
let sqlSetup: Promise<NeonSql> | undefined;

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

async function sqlClient() {
  const url = databaseUrl();
  if (!url) throw new Error("Koppel eerst de Neon-database met de variabele DATABASE_URL in Vercel.");
  sqlSetup ??= import("@neondatabase/serverless").then(({ neon }) => neon<false, false>(url, { fullResults: false, arrayMode: false }));
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
        maintenance SMALLINT NOT NULL DEFAULT 0 CHECK (maintenance IN (0, 1)),
        maintenance_message TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )`;
      await sql`ALTER TABLE amrp_status_services ADD COLUMN IF NOT EXISTS maintenance SMALLINT NOT NULL DEFAULT 0`;
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
      await sql`CREATE TABLE IF NOT EXISTS amrp_status_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)`;
    })().catch((error) => {
      schemaSetup = undefined;
      throw error;
    });
  }
  await schemaSetup;
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
          "INSERT INTO amrp_status_services (id, name, category, kind, endpoint, enabled, maintenance, maintenance_message, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (id) DO NOTHING",
          [service.id, service.name, service.category, service.kind, service.endpoint, service.enabled, service.maintenance, service.maintenanceMessage, now],
        );
      }
    }
    await sql`INSERT INTO amrp_status_migrations (version, applied_at) VALUES ('initial-services-v1', ${now}) ON CONFLICT (version) DO NOTHING`;
  }
  if (!applied.has("dev-server-v1")) {
    const service = DEFAULT_SERVICES.find((item) => item.id === "fivem-dev");
    if (service) {
      await sql.query(
        "INSERT INTO amrp_status_services (id, name, category, kind, endpoint, enabled, maintenance, maintenance_message, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (id) DO NOTHING",
        [service.id, service.name, service.category, service.kind, service.endpoint, service.enabled, service.maintenance, service.maintenanceMessage, now],
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
    ? await sql`SELECT id, name, category, kind, endpoint, enabled, maintenance, maintenance_message AS "maintenanceMessage" FROM amrp_status_services ORDER BY category, name`
    : await sql`SELECT id, name, category, kind, endpoint, enabled, maintenance, maintenance_message AS "maintenanceMessage" FROM amrp_status_services WHERE enabled = 1 ORDER BY category, name`;
  return rows.map((row) => ({ ...row, enabled: Number(row.enabled), maintenance: Number(row.maintenance) })) as ServiceRow[];
}

export async function saveService(service: Omit<ServiceRow, "id">, id = crypto.randomUUID()) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    const now = Date.now();
    await sql.query(
      "INSERT INTO amrp_status_services (id, name, category, kind, endpoint, enabled, maintenance, maintenance_message, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, kind = EXCLUDED.kind, endpoint = EXCLUDED.endpoint, enabled = EXCLUDED.enabled, maintenance = EXCLUDED.maintenance, maintenance_message = EXCLUDED.maintenance_message, updated_at = EXCLUDED.updated_at",
      [id, service.name, service.category, service.kind, service.endpoint, service.enabled, service.maintenance, service.maintenanceMessage, now],
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

export async function recordHistory(id: string, bucket: number, checkedAt: number, result: { status: ServiceStatus; responseMs: number | null; message: string; players: number | null; maxPlayers: number | null }): Promise<HistoryRow[]> {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    await sql.query(
      "INSERT INTO amrp_status_history (service_id, bucket, status, checked_at, response_ms, message, players, max_players) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (service_id, bucket) DO UPDATE SET status = EXCLUDED.status, checked_at = EXCLUDED.checked_at, response_ms = EXCLUDED.response_ms, message = EXCLUDED.message, players = EXCLUDED.players, max_players = EXCLUDED.max_players",
      [id, bucket, result.status, checkedAt, result.responseMs, result.message, result.players, result.maxPlayers],
    );
    const rows = await sql`SELECT status, checked_at AS "checkedAt" FROM amrp_status_history WHERE service_id = ${id} ORDER BY bucket DESC LIMIT 720`;
    return rows.map((row) => ({ status: row.status as ServiceStatus, checkedAt: Number(row.checkedAt) })).reverse();
  }
  const samples = memoryHistory.get(id) ?? [];
  const next = samples.filter((sample) => Math.floor(sample.checkedAt / 5000) !== bucket);
  next.push({ status: result.status, checkedAt });
  next.sort((a, b) => a.checkedAt - b.checkedAt);
  const trimmed = next.slice(-720);
  memoryHistory.set(id, trimmed);
  return trimmed;
}

export async function pruneHistory(before: number) {
  if (databaseUrl()) {
    await ensureSchema();
    const sql = await sqlClient();
    await sql`DELETE FROM amrp_status_history WHERE checked_at < ${before}`;
    return;
  }
  for (const [id, history] of memoryHistory) memoryHistory.set(id, history.filter((sample) => sample.checkedAt >= before));
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
    maintenance: value.maintenance === true || value.maintenance === 1 ? 1 : 0,
    maintenanceMessage,
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
