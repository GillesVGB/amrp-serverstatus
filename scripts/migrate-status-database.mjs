import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const format = "amrp-status-database-v1";
const batchSize = 500;
// Reviewed app DDL, independent of comments/formatting. Schema changes require an
// explicit migration review; matching only a CREATE prefix would trust its body.
const approvedSchemaSha256 = "79f8bf1224dda0e22dad99ed8ba6f58893388255927309302db24c237460d7ef";
const indexes = new Set([
  "amrp_status_services_enabled_category_idx", "amrp_status_history_checked_at_idx",
  "amrp_status_incidents_open_service_idx", "amrp_status_incidents_started_at_idx",
  "amrp_status_announcements_published_idx",
]);

function table(name, columns, primaryKey) {
  const nullableColumns = new Set(["history.response_ms", "history.players", "history.max_players", "incidents.resolved_at", "incidents.resolution", "announcements.published_at"]);
  return { name: `amrp_status_${name}`, columns: columns.map(([column, type]) => ({ name: column, type, nullable: nullableColumns.has(`${name}.${column}`) })), primaryKey };
}

// Explicit names prevent accidentally exporting or changing another application's data.
export const tables = [
  table("services", [["id", "text"], ["name", "text"], ["category", "text"], ["kind", "text"], ["endpoint", "text"], ["enabled", "int2"], ["paused", "int2"], ["maintenance", "int2"], ["maintenance_message", "text"], ["created_at", "int8"], ["updated_at", "int8"]], ["id"]),
  table("history", [["service_id", "text"], ["bucket", "int8"], ["status", "text"], ["checked_at", "float8"], ["response_ms", "int4"], ["message", "text"], ["players", "int4"], ["max_players", "int4"]], ["service_id", "bucket"]),
  table("incidents", [["id", "int8"], ["service_id", "text"], ["status", "text"], ["reason", "text"], ["started_at", "float8"], ["resolved_at", "float8"], ["resolution", "text"]], ["id"]),
  table("monitor", [["id", "int2"], ["last_successful_at", "float8"]], ["id"]),
  table("announcements", [["id", "text"], ["title", "text"], ["description", "text"], ["kind", "text"], ["affected_services", "jsonb"], ["published", "int2"], ["published_at", "float8"], ["created_at", "int8"], ["updated_at", "int8"]], ["id"]),
  table("site_settings", [["id", "int2"], ["maintenance", "int2"], ["updated_at", "int8"]], ["id"]),
  table("migrations", [["version", "text"], ["applied_at", "int8"]], ["version"]),
];
const tableNames = new Set(tables.map((entry) => entry.name));
const sequenceName = "amrp_status_incidents_id_seq";

export class MigrationError extends Error {
  constructor(message) { super(message); this.name = "MigrationError"; }
}
function requireThat(condition, message) { if (!condition) throw new MigrationError(message); }
const hash = (value) => createHash("sha256").update(value).digest("hex");
const quoted = (name) => `"${name}"`;
const qualified = (name) => `public.${quoted(name)}`;

function statements(sql) {
  // Schema files contain ordinary DDL, without functions or dollar-quoted bodies.
  // Split outside quoted strings/comments so a title/default cannot become a statement.
  const output = [];
  let value = "", quote = null, comment = null;
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index], next = sql[index + 1];
    if (comment === "line") { if (char === "\n") { comment = null; value += " "; } continue; }
    if (comment === "block") { if (char === "*" && next === "/") { comment = null; index++; value += " "; } continue; }
    if (quote) {
      value += char;
      if (char === quote) { if (next === quote) { value += next; index++; } else quote = null; }
      continue;
    }
    if (char === "-" && next === "-") { comment = "line"; index++; continue; }
    if (char === "/" && next === "*") { comment = "block"; index++; continue; }
    if (char === "'" || char === '"') { quote = char; value += char; continue; }
    if (char === ";") { if (value.trim()) output.push(value.trim()); value = ""; }
    else value += char;
  }
  requireThat(!quote && comment !== "block", "Het schemascript is onvolledig.");
  if (value.trim()) output.push(value.trim());
  return output;
}

export function validateSchema(sql) {
  const parsed = statements(sql);
  const created = new Set();
  const protectedTables = new Set();
  for (const statement of parsed) {
    const create = /^CREATE TABLE IF NOT EXISTS (?:public\.)?(amrp_status_[a-z_]+)\s*\(/i.exec(statement);
    if (create) {
      requireThat(tableNames.has(create[1]) && !created.has(create[1]), "Het schema bevat een onverwachte of dubbele tabel.");
      created.add(create[1]);
      continue;
    }
    const index = /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (amrp_status_[a-z_]+) ON (?:public\.)?(amrp_status_[a-z_]+)\s*\(/i.exec(statement);
    if (index && indexes.has(index[1]) && tableNames.has(index[2])) continue;
    const rls = /^ALTER TABLE (?:public\.)?(amrp_status_[a-z_]+) ENABLE ROW LEVEL SECURITY$/i.exec(statement);
    if (rls && tableNames.has(rls[1])) { protectedTables.add(rls[1]); continue; }
    throw new MigrationError("Het schema bevat een opdracht buiten de toegestane statuswebsite-tabellen.");
  }
  requireThat(created.size === tables.length, "Het schema moet precies de zeven statuswebsite-tabellen bevatten.");
  requireThat(protectedTables.size === tables.length, "Het schema moet RLS inschakelen voor alle zeven statuswebsite-tabellen.");
  requireThat(hash(parsed.map((statement) => statement.replace(/\s+/g, " ").trim()).join(";\n")) === approvedSchemaSha256, "De schemadefinities zijn gewijzigd en moeten eerst voor deze migratie worden beoordeeld.");
  return parsed;
}

async function assertColumns(client) {
  const result = await client.query({
    text: "SELECT table_name, column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name, column_name",
    values: [[...tableNames]],
  });
  for (const entry of tables) {
    const byName = (first, second) => first.name < second.name ? -1 : first.name > second.name ? 1 : 0;
    const actual = result.rows.filter((row) => row.table_name === entry.name).map((row) => ({ name: row.column_name, type: row.udt_name, nullable: row.is_nullable === "YES" })).sort(byName);
    requireThat(JSON.stringify(actual) === JSON.stringify([...entry.columns].sort(byName)), `Schema-afwijking in ${entry.name}; migratie gestopt om gegevensverlies te voorkomen.`);
  }
  const sequence = await client.query("SELECT pg_get_serial_sequence('public.amrp_status_incidents', 'id') AS name");
  requireThat(sequence.rows[0]?.name === `public.${sequenceName}`, "De incident-ID-sequence wijkt af van het verwachte schema.");
}

async function schemaSignature(client) {
  const constraints = await client.query({
    // PG18 catalogs NOT NULL as contype=n; PG17 does not. It is checked via is_nullable above.
    text: "SELECT t.relname AS table_name, c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid, true) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname = ANY($1::text[]) AND c.contype <> 'n' ORDER BY t.relname COLLATE \"C\", c.conname COLLATE \"C\"",
    values: [[...tableNames]],
  });
  const indexDefinitions = await client.query({
    text: "SELECT t.relname AS table_name, ix.relname AS name, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_class ix ON ix.oid = i.indexrelid WHERE n.nspname = 'public' AND t.relname = ANY($1::text[]) ORDER BY t.relname COLLATE \"C\", ix.relname COLLATE \"C\"",
    values: [[...tableNames]],
  });
  return { constraints: constraints.rows, indexes: indexDefinitions.rows };
}

async function assertSchemaSignature(client, manifest) {
  requireThat(JSON.stringify(await schemaSignature(client)) === JSON.stringify(manifest.structure), "Sleutels, voorwaarden of indexen verschillen van de bron; migratie gestopt.");
}

async function sessionSettings(client) {
  await client.query("SET LOCAL search_path = public, pg_catalog");
  await client.query("SET LOCAL extra_float_digits = 3");
  await client.query("SET LOCAL timezone = 'UTC'");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '120s'");
}

async function* databaseRows(client, entry) {
  const cursor = `migration_${entry.name}`;
  const selected = entry.columns.map(({ name }) => `${quoted(name)}::text`).join(", ");
  const order = entry.primaryKey.map((name) => `${quoted(name)}${entry.columns.find((column) => column.name === name).type === "text" ? ' COLLATE "C"' : ""}`).join(", ");
  await client.query(`DECLARE ${quoted(cursor)} NO SCROLL CURSOR FOR SELECT ${selected} FROM ${qualified(entry.name)} ORDER BY ${order}`);
  try {
    while (true) {
      const result = await client.query({ text: `FETCH FORWARD ${batchSize} FROM ${quoted(cursor)}`, rowMode: "array" });
      if (!result.rows.length) break;
      for (const row of result.rows) { validateRow(row, entry); yield row; }
    }
  } finally { await client.query(`CLOSE ${quoted(cursor)}`).catch(() => {}); }
}

function validateRow(row, entry) {
  requireThat(Array.isArray(row) && row.length === entry.columns.length && row.every((value) => value === null || typeof value === "string"), `Ongeldige rij in ${entry.name}.`);
}

async function digestRows(rows, onRow) {
  const digest = createHash("sha256");
  let count = 0n, bytes = 0n;
  for await (const row of rows) {
    const line = `${JSON.stringify(row)}\n`;
    digest.update(line);
    count++;
    bytes += BigInt(Buffer.byteLength(line));
    if (onRow) await onRow(row, line);
  }
  return { count: count.toString(), bytes: bytes.toString(), sha256: digest.digest("hex") };
}

function validDigest(value) {
  return value && /^\d+$/.test(value.count) && /^\d+$/.test(value.bytes) && /^[a-f0-9]{64}$/.test(value.sha256);
}
function sameDigest(actual, expected) { return actual.count === expected.count && actual.bytes === expected.bytes && actual.sha256 === expected.sha256; }

export function nextSequenceValue(sequence, maximumId) {
  requireThat(sequence && /^\d+$/.test(sequence.lastValue) && typeof sequence.isCalled === "boolean", "De back-up bevat geen geldige incident-sequence.");
  const next = BigInt(sequence.lastValue) + (sequence.isCalled ? 1n : 0n);
  const afterMaximum = maximumId === null ? 1n : BigInt(maximumId) + 1n;
  const result = next > afterMaximum ? next : afterMaximum;
  requireThat(result >= 1n && result <= 9223372036854775807n, "De incident-sequence heeft geen beschikbare volgende ID.");
  return result.toString();
}

async function sourceSequence(client) {
  const result = await client.query(`SELECT last_value::text AS last_value, is_called FROM ${qualified(sequenceName)}`);
  const settings = await client.query("SELECT increment_by::text AS increment_by, min_value::text AS min_value, max_value::text AS max_value, cycle FROM pg_sequences WHERE schemaname = 'public' AND sequencename = $1", [sequenceName]);
  const config = settings.rows[0];
  requireThat(config?.increment_by === "1" && config.min_value === "1" && config.max_value === "9223372036854775807" && config.cycle === false, "De incident-sequence gebruikt niet-ondersteunde instellingen.");
  const row = result.rows[0];
  const sequence = { name: sequenceName, lastValue: row?.last_value, isCalled: row?.is_called };
  nextSequenceValue(sequence, null);
  return sequence;
}

export async function exportDatabase({ client, backupPath, schemaSql, sourceFingerprint, now = new Date() }) {
  validateSchema(schemaSql);
  requireThat(typeof sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(sourceFingerprint), "De bronidentificatie voor de back-up ontbreekt.");
  await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  await mkdir(backupPath, { mode: 0o700 }); // Never overwrite a previous backup.
  const marker = await open(path.join(backupPath, ".incomplete"), "wx", 0o600);
  await marker.close();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let manifest;
  try {
    await sessionSettings(client);
    await assertColumns(client);
    const sequence = await sourceSequence(client);
    const structure = await schemaSignature(client);
    const schemaFile = await open(path.join(backupPath, "schema.sql"), "wx", 0o600);
    try { await schemaFile.writeFile(schemaSql); } finally { await schemaFile.close(); }
    manifest = { format, createdAt: now.toISOString(), sourceFingerprint, schema: { sha256: hash(schemaSql), bytes: String(Buffer.byteLength(schemaSql)) }, structure, sequence, tables: {} };
    for (const entry of tables) {
      const file = await open(path.join(backupPath, `${entry.name}.ndjson`), "wx", 0o600);
      try {
        const digest = await digestRows(databaseRows(client, entry), async (_row, line) => { await file.writeFile(line); });
        manifest.tables[entry.name] = { columns: entry.columns, ...digest };
      } finally { await file.close(); }
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  const manifestFile = await open(path.join(backupPath, "manifest.json"), "wx", 0o600);
  try { await manifestFile.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); } finally { await manifestFile.close(); }
  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(backupPath, ".incomplete"));
  return manifest;
}

async function* backupRows(backupPath, entry) {
  const stream = createReadStream(path.join(backupPath, `${entry.name}.ndjson`));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let row;
      try { row = JSON.parse(line); } catch { throw new MigrationError(`Ongeldige NDJSON in ${entry.name}.`); }
      validateRow(row, entry);
      yield row;
    }
  } finally { lines.close(); stream.destroy(); }
}

async function assertRegularFile(filePath) {
  const stat = await lstat(filePath);
  requireThat(stat.isFile() && !stat.isSymbolicLink(), "De back-up bevat een onverwacht bestand of een symbolische koppeling.");
  return stat;
}

export async function inspectBackup(backupPath) {
  await assertRegularFile(path.join(backupPath, "manifest.json"));
  try { await lstat(path.join(backupPath, ".incomplete")); throw new MigrationError("De export is niet voltooid; gebruik deze back-up niet."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(backupPath, "manifest.json"), "utf8")); }
  catch (error) { if (error instanceof SyntaxError) throw new MigrationError("Het back-upmanifest is ongeldig."); throw error; }
  requireThat(manifest?.format === format && typeof manifest.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(manifest.sourceFingerprint), "Dit is geen ondersteunde statuswebsite-back-up.");
  requireThat(manifest.tables && JSON.stringify(Object.keys(manifest.tables).sort()) === JSON.stringify([...tableNames].sort()), "Het manifest moet precies de zeven statuswebsite-tabellen bevatten.");
  requireThat(manifest.structure && Array.isArray(manifest.structure.constraints) && Array.isArray(manifest.structure.indexes), "De back-up bevat geen controle van sleutels en indexen.");
  const schemaStat = await assertRegularFile(path.join(backupPath, "schema.sql"));
  const schemaSql = await readFile(path.join(backupPath, "schema.sql"), "utf8");
  requireThat(manifest.schema?.sha256 === hash(schemaSql) && manifest.schema.bytes === String(schemaStat.size), "Het back-upschema wijkt af van het manifest.");
  validateSchema(schemaSql);
  requireThat(manifest.sequence?.name === sequenceName, "Onverwachte sequence in de back-up.");
  nextSequenceValue(manifest.sequence, null);
  for (const entry of tables) {
    const expected = manifest.tables[entry.name];
    requireThat(validDigest(expected) && JSON.stringify(expected.columns) === JSON.stringify(entry.columns), `Ongeldige tabelbeschrijving voor ${entry.name}.`);
    const stat = await assertRegularFile(path.join(backupPath, `${entry.name}.ndjson`));
    const actual = await digestRows(backupRows(backupPath, entry));
    requireThat(String(stat.size) === expected.bytes && sameDigest(actual, expected), `Controle van de back-up mislukt voor ${entry.name}; import afgebroken.`);
  }
  return { manifest, schemaSql };
}

async function verifyTables(client, manifest) {
  for (const entry of tables) {
    const actual = await digestRows(databaseRows(client, entry));
    requireThat(sameDigest(actual, manifest.tables[entry.name]), `De gegevenscontrole van ${entry.name} is mislukt.`);
  }
}

async function targetSequence(client, manifest, restore) {
  const maximum = await client.query("SELECT max(id)::text AS maximum FROM public.amrp_status_incidents");
  const expected = nextSequenceValue(manifest.sequence, maximum.rows[0]?.maximum ?? null);
  if (restore) {
    // RESTART is transactional; setval() would survive a transaction rollback.
    // Its is_called=false representation preserves the source's next available ID.
    await client.query(`ALTER SEQUENCE ${qualified(sequenceName)} RESTART WITH ${expected}`);
  }
  const result = await client.query(`SELECT last_value::text AS last_value, is_called FROM ${qualified(sequenceName)}`);
  const row = result.rows[0];
  const actual = nextSequenceValue({ lastValue: row?.last_value, isCalled: row?.is_called }, null);
  requireThat(actual === expected, "De volgende incident-ID op het doel komt niet overeen met de back-up.");
}

export async function importDatabase({ client, backupPath, backup, targetFingerprint }) {
  const { manifest, schemaSql } = backup ?? await inspectBackup(backupPath);
  requireThat(targetFingerprint !== manifest.sourceFingerprint, "Bron en doel lijken dezelfde database; import geweigerd.");
  await client.query("BEGIN");
  try {
    await sessionSettings(client);
    for (const statement of validateSchema(schemaSql)) await client.query(statement);
    await client.query(`LOCK TABLE ${tables.map((entry) => qualified(entry.name)).join(", ")} IN ACCESS EXCLUSIVE MODE`);
    await assertColumns(client);
    await assertSchemaSignature(client, manifest);
    for (const entry of tables) {
      const result = await client.query(`SELECT count(*)::text AS count FROM ${qualified(entry.name)}`);
      requireThat(result.rows[0]?.count === "0", `Doeltabel ${entry.name} is niet leeg; er is niets overschreven.`);
    }
    for (const entry of tables) {
      let batch = [];
      const insert = async () => {
        if (!batch.length) return;
        const values = batch.flat();
        const rows = batch.map((_row, rowIndex) => `(${entry.columns.map((_column, columnIndex) => `$${rowIndex * entry.columns.length + columnIndex + 1}`).join(", ")})`).join(", ");
        await client.query({ text: `INSERT INTO ${qualified(entry.name)} (${entry.columns.map(({ name }) => quoted(name)).join(", ")}) VALUES ${rows}`, values });
        batch = [];
      };
      const actual = await digestRows(backupRows(backupPath, entry), async (row) => { batch.push(row); if (batch.length >= batchSize) await insert(); });
      await insert();
      requireThat(sameDigest(actual, manifest.tables[entry.name]), `De back-up wijzigde tijdens import van ${entry.name}; alles wordt teruggedraaid.`);
    }
    await verifyTables(client, manifest);
    await targetSequence(client, manifest, true);
    await client.query("COMMIT");
    return manifest;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

export async function verifyDatabase({ client, backupPath, backup }) {
  const { manifest } = backup ?? await inspectBackup(backupPath);
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await sessionSettings(client);
    await assertColumns(client);
    await assertSchemaSignature(client, manifest);
    await verifyTables(client, manifest);
    await targetSequence(client, manifest, false);
    await client.query("COMMIT");
    return manifest;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

export function connectionConfig(value, role, caCertificate) {
  requireThat(value, `${role === "source" ? "SOURCE" : "TARGET"}_DATABASE_URL ontbreekt. Gebruik een privé .env.migration.local-bestand.`);
  let url;
  try { url = new URL(value); } catch { throw new MigrationError("De databaseverbinding is ongeldig."); }
  requireThat(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname && url.username && url.pathname.length > 1, "Gebruik een PostgreSQL-verbindingsadres, geen API-URL.");
  requireThat(url.port !== "6543", "Gebruik voor deze migratie een directe verbinding of session-pooler op poort 5432, geen transaction-pooler.");
  requireThat(!(role === "source" && url.hostname.endsWith(".neon.tech") && url.hostname.includes("-pooler.")), "Gebruik de directe (niet-gepoolde) Neon-verbinding voor de bronexport.");
  requireThat([null, "require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode")) && !["false", "0", "no-verify"].includes(url.searchParams.get("ssl")), "Gebruik een databaseverbinding met gecontroleerde TLS.");
  requireThat(!["sslrootcert", "sslcert", "sslkey"].some((name) => url.searchParams.has(name)), "Geef een provider-CA als PEM via SOURCE_DATABASE_CA_CERT of TARGET_DATABASE_CA_CERT, niet als bestandspad in de URL.");
  let ca;
  if (caCertificate) {
    ca = caCertificate.replace(/\\n/g, "\n").trim();
    requireThat(ca.includes("-----BEGIN CERTIFICATE-----") && ca.includes("-----END CERTIFICATE-----"), "Het opgegeven database-CA-certificaat is geen PEM-certificaat.");
  }
  // pg connection-string SSL options can overwrite an explicit SSL object.
  // Remove them and always enforce CA and hostname verification ourselves.
  for (const name of [...url.searchParams.keys()]) if (name.toLowerCase().startsWith("ssl")) url.searchParams.delete(name);
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, fingerprint: hash(`${url.hostname.toLowerCase()}:${url.port || "5432"}${url.pathname}`) };
}

async function safeBackupPath(value, command) {
  const relative = value || `.local/status-migration/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  requireThat(command === "export" || value, "Geef bij import en verify het bestaande back-uppad op met --backup.");
  const root = path.join(projectRoot, ".local");
  const destination = path.resolve(projectRoot, relative);
  requireThat(destination.startsWith(`${root}${path.sep}`), "Bewaar migratieback-ups binnen de genegeerde projectmap .local/.");
  let current = projectRoot;
  for (const segment of path.relative(projectRoot, destination).split(path.sep)) {
    current = path.join(current, segment);
    try { const stat = await lstat(current); requireThat(!stat.isSymbolicLink(), "Gebruik geen symbolische koppelingen voor privéback-ups."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  // Resolve the checkout root too; comparisons above must not depend on CWD.
  await realpath(projectRoot);
  return destination;
}

const help = `Statusdatabase migreren (Node.js 22+)

  node --env-file=.env.migration.local scripts/migrate-status-database.mjs export [--backup .local/status-migration/naam]
  node --env-file=.env.migration.local scripts/migrate-status-database.mjs import --backup .local/status-migration/naam
  node --env-file=.env.migration.local scripts/migrate-status-database.mjs verify --backup .local/status-migration/naam

export: SOURCE_DATABASE_URL, read-only snapshot van alle 7 amrp_status_* tabellen.
import: TARGET_DATABASE_URL, alleen een leeg doel; controle vóór transactionele commit.
verify: TARGET_DATABASE_URL, read-only vergelijking met de volledige back-up.
Bron en doel moeten tijdens de definitieve migratie geen schrijvers hebben.
Er worden nooit automatisch Neon-gegevens verwijderd. Zie docs/SUPABASE-MIGRATIE.md.
`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(help); return; }
  const [command, ...options] = args;
  requireThat(["export", "import", "verify"].includes(command), "Kies export, import of verify; gebruik --help voor uitleg.");
  requireThat(options.length === 0 || (options.length === 2 && options[0] === "--backup" && options[1]), "Onbekende argumenten; gebruik --help.");
  const backupPath = await safeBackupPath(options[1], command);
  // Check every backup file before connecting to a target database.
  const backup = command === "export" ? undefined : await inspectBackup(backupPath);
  const role = command === "export" ? "source" : "target";
  const config = connectionConfig(process.env[`${role.toUpperCase()}_DATABASE_URL`], role, process.env[`${role.toUpperCase()}_DATABASE_CA_CERT`]);
  if (command === "import") requireThat(config.fingerprint !== backup.manifest.sourceFingerprint, "Bron en doel lijken dezelfde database; import geweigerd.");
  const { Client } = await import("pg");
  const client = new Client({ connectionString: config.connectionString, ssl: config.ssl, application_name: "amrp-status-migration", connectionTimeoutMillis: 15000, query_timeout: 135000 });
  // An idle connection error must not escape as an uncaught raw provider error.
  client.on("error", () => {});
  try {
    await client.connect();
    const manifest = command === "export"
      ? await exportDatabase({ client, backupPath, sourceFingerprint: config.fingerprint, schemaSql: await readFile(path.join(projectRoot, "db", "postgres.sql"), "utf8") })
      : command === "import"
        ? await importDatabase({ client, backupPath, backup, targetFingerprint: config.fingerprint })
        : await verifyDatabase({ client, backupPath, backup });
    console.log(`${command === "export" ? "Export voltooid" : command === "import" ? "Import voltooid en gecontroleerd" : "Alle gegevens gecontroleerd"}: ${path.relative(projectRoot, backupPath)}`);
    for (const entry of tables) console.log(`  ${entry.name}: ${manifest.tables[entry.name].count} rijen`);
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    if (error instanceof MigrationError) console.error(error.message);
    else if (/exceed.*quota|quota.*exceed|data transfer|network transfer/i.test(String(error?.message ?? ""))) console.error("De bronprovider blokkeert de verbinding door een quotum. Een directe verbinding omzeilt deze limiet niet; hervat export zodra de bron weer bereikbaar is.");
    else console.error("Migratie gestopt door een bestands- of databasefout. Niet-gecommitteerde wijzigingen worden teruggedraaid; gebruik verify bij een onderbroken commit. Onvoltooide exports zijn niet bruikbaar. Controleer verbinding, TLS, rechten en beschikbare ruimte. Verbindingsgegevens en providerfouten worden niet getoond.");
    process.exitCode = 1;
  });
}
