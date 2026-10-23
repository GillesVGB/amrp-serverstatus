import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connectionConfig, exportDatabase, importDatabase, inspectBackup, nextSequenceValue, tables, validateSchema, verifyDatabase } from "./migrate-status-database.mjs";

// These checks use files in the OS temp directory and an in-memory pg client.
// They never read environment credentials or open a database connection.
const schemaSql = await readFile(new URL("../db/postgres.sql", import.meta.url), "utf8");
const sourceFingerprint = "a".repeat(64), targetFingerprint = "b".repeat(64);
const sourceSequence = { last_value: "9007199254741000", is_called: true };
const fixture = {
  amrp_status_services: [["main", "AMRP \"Main\"", "FiveM", "fivem", "https://example.invalid/health", "1", "0", "0", "", "9007199254740993", "1792771234567"]],
  amrp_status_history: [["main", "1792771200000", "operational", "1792771234567.125", "93", "Alles goed\nOok op regel twee", "2", "128"], ["main", "1792771260000", "unknown", "1792771294567.25", null, "Wachten", null, null]],
  amrp_status_incidents: [["9007199254740993", "main", "down", "Tijdelijk onbereikbaar", "1792771234567.125", null, null]],
  amrp_status_monitor: [["1", "1792771234567.125"]],
  amrp_status_announcements: [["notice-1", "Onderhoud", "Nieuwe versie\nTweede regel", "notice", '[{"id": "main", "name": "Hoofdserver", "large": 9007199254740993}]', "1", "1792771234567.125", "1792771200000", "1792771234567"]],
  amrp_status_site_settings: [["1", "1", "1792771234567"]],
  amrp_status_migrations: [["initial-services-v1", "1792771200000"]],
};
const structure = {
  constraints: tables.map((entry) => ({ table_name: entry.name, name: `${entry.name}_pkey`, type: "p", definition: `PRIMARY KEY (${entry.primaryKey.join(", ")})` })),
  indexes: tables.map((entry) => ({ table_name: entry.name, name: `${entry.name}_pkey`, definition: `CREATE UNIQUE INDEX ${entry.name}_pkey ON public.${entry.name}` })),
};
const clone = (value) => structuredClone(value);
const empty = () => Object.fromEntries(tables.map((entry) => [entry.name, []]));

class MemoryClient {
  constructor(data = fixture, options = {}) {
    this.data = clone(data);
    this.sequence = clone(options.sequence ?? sourceSequence);
    this.options = options;
    this.calls = [];
    this.cursors = new Map();
  }
  async query(input, parameters) {
    const text = typeof input === "string" ? input : input.text;
    const values = typeof input === "string" ? parameters : input.values;
    this.calls.push(text);
    if (text.startsWith("BEGIN")) { this.snapshot = clone({ data: this.data, sequence: this.sequence }); return { rows: [] }; }
    if (text === "ROLLBACK") { if (this.snapshot) Object.assign(this, clone(this.snapshot)); this.snapshot = null; return { rows: [] }; }
    if (text === "COMMIT") { this.snapshot = null; return { rows: [] }; }
    if (text.startsWith("SET LOCAL") || /^(CREATE |ALTER TABLE |LOCK TABLE )/.test(text)) return { rows: [] };
    if (text.includes("information_schema.columns")) {
      const rows = tables.flatMap((entry) => entry.columns.map((column) => ({ table_name: entry.name, column_name: column.name, udt_name: column.type, is_nullable: column.nullable ? "YES" : "NO" }))).filter((row) => !this.options.missingColumn || row.column_name !== "endpoint");
      return { rows: this.options.reorderedColumns ? rows.reverse() : rows };
    }
    if (text.includes("pg_get_serial_sequence")) return { rows: [{ name: "public.amrp_status_incidents_id_seq" }] };
    if (text.includes("FROM pg_constraint")) return { rows: clone(structure.constraints) };
    if (text.includes("FROM pg_index")) return { rows: this.options.badIndex ? [] : clone(structure.indexes) };
    if (text.includes("FROM pg_sequences")) return { rows: [{ increment_by: "1", min_value: "1", max_value: "9223372036854775807", cycle: false }] };
    if (text.startsWith("SELECT last_value")) return { rows: [clone(this.sequence)] };
    if (text.startsWith("ALTER SEQUENCE")) {
      if (this.options.failSequence) throw new Error("simulated sequence failure");
      this.sequence = { last_value: /RESTART WITH (\d+)$/.exec(text)[1], is_called: false };
      return { rows: [] };
    }
    if (text.startsWith("SELECT max(id)")) {
      const ids = this.data.amrp_status_incidents.map((row) => BigInt(row[0]));
      return { rows: [{ maximum: ids.length ? ids.reduce((a, b) => a > b ? a : b).toString() : null }] };
    }
    if (text.startsWith("SELECT count(*)")) return { rows: [{ count: String(this.data[/public\."([a-z_]+)"/.exec(text)[1]].length) }] };
    if (text.startsWith("DECLARE")) {
      const cursor = /^DECLARE "([a-z_]+)"/.exec(text)[1];
      const table = /FROM public\."([a-z_]+)"/.exec(text)[1];
      const rows = clone(this.data[table]);
      if (this.options.corruptRead && table === "amrp_status_history" && rows.length) rows[0][2] = "down";
      this.cursors.set(cursor, rows);
      return { rows: [] };
    }
    if (text.startsWith("FETCH")) {
      if (this.options.failRead) throw new Error("simulated connection failure");
      const cursor = /FROM "([a-z_]+)"/.exec(text)[1];
      return { rows: this.cursors.get(cursor).splice(0, 500) };
    }
    if (text.startsWith("CLOSE")) { this.cursors.delete(/"([a-z_]+)"/.exec(text)[1]); return { rows: [] }; }
    if (text.startsWith("INSERT INTO")) {
      const name = /^INSERT INTO public\."([a-z_]+)"/.exec(text)[1];
      if (this.options.failInsert === name) throw new Error("simulated insert failure");
      const width = tables.find((entry) => entry.name === name).columns.length;
      for (let index = 0; index < values.length; index += width) this.data[name].push(values.slice(index, index + width));
      return { rows: [] };
    }
    throw new Error(`Unexpected offline test query: ${text}`);
  }
}

async function backupFor(t, client = new MemoryClient()) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "amrp-status-migration-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const backupPath = path.join(temporary, "backup");
  const manifest = await exportDatabase({ client, backupPath, schemaSql, sourceFingerprint });
  return { backupPath, manifest };
}

test("Export is read-only and preserves all seven tables, int8, JSONB, nulls and fractional timestamps", async (t) => {
  const source = new MemoryClient();
  const { backupPath, manifest } = await backupFor(t, source);
  const inspected = await inspectBackup(backupPath);
  assert.deepEqual(inspected.manifest, manifest);
  assert.equal(Object.keys(manifest.tables).length, 7);
  assert.equal(manifest.tables.amrp_status_history.count, "2");
  assert.equal(manifest.sequence.lastValue, "9007199254741000");
  assert.equal(source.calls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(source.calls.at(-1), "COMMIT");
  assert.ok(!source.calls.some((call) => /^(INSERT|UPDATE|DELETE|ALTER|CREATE)/.test(call)));
  for (const entry of tables) {
    const text = await readFile(path.join(backupPath, `${entry.name}.ndjson`), "utf8");
    assert.deepEqual(text.trimEnd().split("\n").map(JSON.parse), fixture[entry.name]);
    assert.equal(createHash("sha256").update(text).digest("hex"), manifest.tables[entry.name].sha256);
  }
});

test("Empty target imports exactly and verifies before committing; sequence preserves the high-water mark", async (t) => {
  const { backupPath } = await backupFor(t);
  const target = new MemoryClient(empty());
  await importDatabase({ client: target, backupPath, targetFingerprint });
  assert.deepEqual(target.data, fixture);
  assert.deepEqual(target.sequence, { last_value: "9007199254741001", is_called: false });
  assert.equal(target.calls.at(-1), "COMMIT");
  assert.ok(target.calls.some((call) => call.startsWith("LOCK TABLE")));
  assert.ok(!target.calls.some((call) => /^(DROP|TRUNCATE|DELETE)\b|\bsetval\s*\(/i.test(call)));
  const after = target.calls.length;
  await verifyDatabase({ client: target, backupPath });
  assert.ok(!target.calls.slice(after).some((call) => /^(INSERT|UPDATE|DELETE|ALTER|CREATE)/.test(call)));
});

test("Nonempty target is never overwritten and schema actions roll back", async (t) => {
  const { backupPath } = await backupFor(t);
  const target = new MemoryClient();
  await assert.rejects(importDatabase({ client: target, backupPath, targetFingerprint }), /niet leeg/);
  assert.deepEqual(target.data, fixture);
  assert.equal(target.calls.at(-1), "ROLLBACK");
  assert.ok(!target.calls.some((call) => call.startsWith("INSERT")));
});

test("An insert failure rolls back previous rows and never reaches commit", async (t) => {
  const { backupPath } = await backupFor(t);
  const target = new MemoryClient(empty(), { failInsert: "amrp_status_history" });
  await assert.rejects(importDatabase({ client: target, backupPath, targetFingerprint }), /simulated insert/);
  assert.deepEqual(target.data, empty());
  assert.equal(target.calls.at(-1), "ROLLBACK");
  assert.ok(!target.calls.includes("COMMIT"));
});

test("A data mismatch after insert prevents commit and rolls back every table", async (t) => {
  const { backupPath } = await backupFor(t);
  const target = new MemoryClient(empty(), { corruptRead: true });
  await assert.rejects(importDatabase({ client: target, backupPath, targetFingerprint }), /gegevenscontrole/);
  assert.deepEqual(target.data, empty());
  assert.equal(target.calls.at(-1), "ROLLBACK");
});

test("A sequence restore failure rolls back all data", async (t) => {
  const { backupPath } = await backupFor(t);
  const target = new MemoryClient(empty(), { failSequence: true });
  await assert.rejects(importDatabase({ client: target, backupPath, targetFingerprint }), /sequence failure/);
  assert.deepEqual(target.data, empty());
  assert.deepEqual(target.sequence, sourceSequence);
  assert.equal(target.calls.at(-1), "ROLLBACK");
});

test("Corrupt backup data is rejected before any target query", async (t) => {
  const { backupPath } = await backupFor(t);
  await writeFile(path.join(backupPath, "amrp_status_history.ndjson"), "[]\n");
  const target = new MemoryClient(empty());
  await assert.rejects(importDatabase({ client: target, backupPath, targetFingerprint }), /Ongeldige rij/);
  assert.equal(target.calls.length, 0);
});

test("Modified backup schema or unexpected table is rejected", async (t) => {
  const { backupPath } = await backupFor(t);
  await writeFile(path.join(backupPath, "schema.sql"), `${schemaSql}\nDROP SCHEMA public CASCADE;`);
  await assert.rejects(inspectBackup(backupPath), /schema wijkt af/);
  assert.throws(() => validateSchema(`${schemaSql}\nCREATE TABLE IF NOT EXISTS other_application (id text);`), /buiten|onverwachte/);
  assert.throws(() => validateSchema(`${schemaSql}\nDELETE FROM amrp_status_history;`), /buiten/);
  assert.throws(() => validateSchema(schemaSql.replace("maintenance_message TEXT NOT NULL DEFAULT ''", "maintenance_message TEXT NOT NULL DEFAULT current_user")), /schemadefinities zijn gewijzigd/);
});

test("Incomplete export is not accepted and source transaction rolls back", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "amrp-status-migration-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const backupPath = path.join(temporary, "backup");
  const source = new MemoryClient(fixture, { failRead: true });
  await assert.rejects(exportDatabase({ client: source, backupPath, schemaSql, sourceFingerprint }), /connection failure/);
  await assert.rejects(inspectBackup(backupPath));
  assert.equal(source.calls.at(-1), "ROLLBACK");
  assert.deepEqual(source.data, fixture);
});

test("Column drift and index differences stop import without inserting rows", async (t) => {
  const { backupPath } = await backupFor(t);
  for (const options of [{ missingColumn: true }, { badIndex: true }]) {
    const target = new MemoryClient(empty(), options);
    await assert.rejects(importDatabase({ client: target, backupPath, targetFingerprint }), /Schema-afwijking|indexen verschillen/);
    assert.deepEqual(target.data, empty());
    assert.ok(!target.calls.some((call) => call.startsWith("INSERT")));
    assert.equal(target.calls.at(-1), "ROLLBACK");
  }
});

test("Legitimate legacy column append order does not change export or import", async (t) => {
  const source = new MemoryClient(fixture, { reorderedColumns: true });
  const { backupPath } = await backupFor(t, source);
  const target = new MemoryClient(empty(), { reorderedColumns: true });
  await importDatabase({ client: target, backupPath, targetFingerprint });
  assert.deepEqual(target.data, fixture);
});

test("A database with no rows exports and imports without inventing seeded services", async (t) => {
  const source = new MemoryClient(empty(), { sequence: { last_value: "1", is_called: false } });
  const { backupPath, manifest } = await backupFor(t, source);
  assert.ok(Object.values(manifest.tables).every((entry) => entry.count === "0"));
  const target = new MemoryClient(empty());
  await importDatabase({ client: target, backupPath, targetFingerprint });
  assert.deepEqual(target.data, empty());
  assert.deepEqual(target.sequence, { last_value: "1", is_called: false });
});

test("Import refuses source and target identity before querying", async (t) => {
  const { backupPath } = await backupFor(t);
  const client = new MemoryClient(empty());
  await assert.rejects(importDatabase({ client, backupPath, targetFingerprint: sourceFingerprint }), /dezelfde database/);
  assert.equal(client.calls.length, 0);
});

test("Sequence logic retains unused IDs and safely advances above existing IDs without Number rounding", () => {
  assert.equal(nextSequenceValue({ lastValue: "20", isCalled: false }, "9"), "20");
  assert.equal(nextSequenceValue({ lastValue: "20", isCalled: true }, "9"), "21");
  assert.equal(nextSequenceValue({ lastValue: "1", isCalled: false }, "9007199254740993"), "9007199254740994");
  assert.throws(() => nextSequenceValue({ lastValue: "9223372036854775807", isCalled: true }, null), /geen beschikbare/);
});

test("Connection parsing requires PostgreSQL/TLS and migration-compatible pooling; fingerprint contains no credentials", () => {
  const first = connectionConfig("postgresql://owner:private-password@db.example.invalid:5432/postgres", "target");
  const second = connectionConfig("postgresql://different:other-password@db.example.invalid:5432/postgres", "target");
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.fingerprint.length, 64);
  assert.equal(new URL(first.connectionString).searchParams.get("sslmode"), null);
  assert.deepEqual(first.ssl, { rejectUnauthorized: true });
  assert.throws(() => connectionConfig("https://db.example.invalid", "target"), /PostgreSQL/);
  assert.throws(() => connectionConfig("postgresql://u:p@host.invalid:6543/postgres", "target"), /transaction-pooler/);
  assert.throws(() => connectionConfig("postgresql://u:p@ep-name-pooler.region.aws.neon.tech/db", "source"), /niet-gepoolde/);
  assert.throws(() => connectionConfig("postgresql://u:p@host.invalid/db?sslmode=disable", "source"), /TLS/);
  assert.throws(() => connectionConfig("postgresql://u:p@host.invalid/db?sslmode=no-verify", "source"), /TLS/);
  assert.throws(() => connectionConfig("postgresql://u:p@host.invalid/db?ssl=no-verify", "target"), /TLS/);
  assert.throws(() => connectionConfig("postgresql://u:p@host.invalid/db?sslrootcert=ca.pem", "target"), /provider-CA/);
  const strict = connectionConfig("postgresql://u:p@host.invalid/db?sslmode=require", "target", "-----BEGIN CERTIFICATE-----\\ntest\\n-----END CERTIFICATE-----");
  assert.equal(strict.ssl.rejectUnauthorized, true);
  assert.equal(strict.ssl.ca, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----");
  assert.ok(!strict.connectionString.includes("ssl"));
});
