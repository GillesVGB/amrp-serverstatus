import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TextEncoder } from "node:util";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const compiled = new Map();

function source(path) {
  if (!compiled.has(path)) {
    compiled.set(path, ts.transpileModule(readFileSync(new URL(path, root), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  }
  return compiled.get(path);
}

function service(id, overrides = {}) {
  return { id, name: id, category: "Websites", kind: "website", endpoint: `https://${id}.example/`, enabled: 1, paused: 0, maintenance: 0, maintenanceMessage: "", ...overrides };
}

function announcement(serviceIds, overrides = {}) {
  return { id: "outage", title: "Algemene storing", description: "Onderzoek loopt.", kind: "outage", published: true, publishedAt: Date.now(), affectedServices: serviceIds.map((id) => ({ id, name: id })), ...overrides };
}

function harness(options = {}) {
  const services = options.services ?? [service("website")];
  const checkedAt = Date.now();
  const dashboard = options.dashboard ?? {
    services,
    snapshot: options.snapshot ?? services.map((entry) => ({ id: entry.id, status: "operational", message: "Adres bereikbaar", responseMs: 120, players: null, maxPlayers: null, checkedAt })),
    monitorCheckedAt: options.monitorCheckedAt === undefined ? checkedAt : options.monitorCheckedAt,
    histories: Object.fromEntries(services.map((entry) => [entry.id, [{ status: "operational", checkedAt, message: "OK" }]])),
    incidents: options.incidents ?? [],
    announcements: options.announcements ?? [],
  };
  const calls = {
    settings: 0, adminSession: 0, dashboard: 0, services: 0, recorded: [], incidents: [],
    prune: [], probes: [], alerts: [], snapshots: [], releases: [], leases: 0, schedules: 0,
  };
  const environment = { MONITOR_SECRET: options.secret ?? "test-monitor-secret", ...(options.webhook ? { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" } : {}) };
  const imports = {
    "@/app/lib/server": {
      getSiteSettingsReadOnly: async () => { calls.settings++; if (options.databaseError) throw options.databaseError; return { maintenance: options.siteMaintenance ?? false, reason: "Gepland onderhoud" }; },
      hasAdminSession: async () => { calls.adminSession++; return options.admin ?? false; },
      getStatusDashboardData: async (range) => { calls.dashboard++; if (options.databaseError) throw options.databaseError; calls.range = range; return dashboard; },
      acquireMonitorLease: async () => { calls.leases++; return options.leaseBusy ? null : "test-lease"; },
      releaseMonitorLease: async (token) => { calls.releases.push(token); },
      listServices: async () => { calls.services++; if (options.databaseError) throw options.databaseError; return services; },
      recordHistory: async (id, bucket, at, result) => { calls.recorded.push({ id, bucket, checkedAt: at, ...result }); },
      recordIncidentState: async (current, status, message, at) => {
        calls.incidents.push({ id: current.id, status, message, checkedAt: at });
        const change = options.incidentChanges?.[current.id];
        return Array.isArray(change) ? change.shift() ?? null : change ?? null;
      },
      pruneHistory: async (before) => { calls.prune.push(before); },
      recordMonitorSnapshot: async (token, at, snapshot) => { calls.snapshots.push({ token, checkedAt: at, snapshot }); return true; },
    },
    "@/app/lib/admin-storage": {
      confirmAutomaticProbe: async (id, status) => options.failures?.[id] ?? (status === "down" || status === "degraded" ? 3 : 0),
    },
    "@/app/lib/admin-operations": { runScheduledMaintenance: async () => { calls.schedules++; } },
    "@/app/lib/database-availability": { markDatabaseUnavailable: () => ({ retryAfterSeconds: 300 }) },
  };

  function load(path) {
    const exports = {};
    vm.runInNewContext(source(path), {
      exports,
      require: (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; },
      Request, Response, URL, AbortController, Date, Map, Set, Promise, JSON, Number, String, Math, Error,
      setTimeout, clearTimeout,
      process: { env: environment },
      fetch: async (url, init = {}) => {
        const target = String(url);
        if (target === environment.DISCORD_WEBHOOK_URL) {
          calls.alerts.push(JSON.parse(init.body));
          return new Response(null, { status: 204 });
        }
        calls.probes.push(target);
        const matching = services.find((entry) => target.startsWith(entry.endpoint));
        if (matching?.kind === "fivem") return Response.json({ clients: 5, sv_maxclients: 128, hostname: "Game" });
        return new Response("OK", { status: options.probeStatuses?.[matching?.id] ?? 200 });
      },
    }, { filename: path });
    return exports;
  }

  imports["@/app/lib/announcement-status"] = load("app/lib/announcement-status.ts");
  imports["@/app/lib/website-maintenance"] = load("app/lib/website-maintenance.ts");
  const status = load("app/api/status/route.ts");
  const monitor = load("app/api/monitor/route.ts");
  return {
    calls, services, status, monitor,
    request: (range = "1h") => new Request(`https://status.example/api/status?range=${range}`),
    monitorRequest: (bearer = environment.MONITOR_SECRET) => new Request("https://status.example/api/monitor", { method: "POST", headers: { Authorization: `Bearer ${bearer}` } }),
  };
}

test("public status reads the last monitor snapshot and preserves dashboard fields without writes", async () => {
  const services = [service("website"), service("maintenance", { maintenance: 1, maintenanceMessage: "Service update" }), service("announced")];
  const checkedAt = Date.now() - 2_000;
  const h = harness({
    services, monitorCheckedAt: checkedAt,
    snapshot: [
      { id: "website", status: "operational", message: "Adres bereikbaar", responseMs: 98, players: null, maxPlayers: null, checkedAt },
      { id: "maintenance", status: "operational", message: "Adres bereikbaar", responseMs: 91, players: null, maxPlayers: null, checkedAt },
      { id: "announced", status: "operational", message: "Adres bereikbaar", responseMs: 85, players: null, maxPlayers: null, checkedAt },
    ],
    announcements: [announcement(["announced"])],
  });
  const response = await h.status.GET(h.request("12h"));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.equal(data.range, "12h");
  assert.equal(data.checkIntervalSeconds, 600);
  assert.equal(data.monitorStatus, "active");
  assert.equal(data.checkedAt, checkedAt);
  assert.deepEqual(Object.keys(data).sort(), ["announcements", "checkIntervalSeconds", "checkedAt", "incidents", "monitorCheckedAt", "monitorStatus", "range", "services"].sort());
  assert.equal(h.calls.range, "12h");
  assert.equal(h.calls.dashboard, 1);
  assert.equal(h.calls.probes.length, 0);
  assert.equal(h.calls.recorded.length, 0);
  assert.equal(h.calls.incidents.length, 0);
  assert.equal(h.calls.snapshots.length, 0);
  assert.equal(data.services.find(({ id }) => id === "website").responseMs, 98);
  assert.equal(data.services.find(({ id }) => id === "maintenance").status, "maintenance");
  assert.equal(data.services.find(({ id }) => id === "maintenance").message, "Service update");
  assert.equal(data.services.find(({ id }) => id === "announced").status, "down");
  assert.equal(data.services.find(({ id }) => id === "announced").history[0].status, "operational");
  assert.equal(data.services.find(({ id }) => id === "website").uptime, 100);
});

test("public maintenance mode hides dashboard data while an authenticated admin can still read it", async () => {
  const h = harness({ siteMaintenance: true });
  const blocked = await h.status.GET(h.request());
  const blockedData = await blocked.json();
  assert.equal(blocked.status, 503);
  assert.equal(blocked.headers.get("Cache-Control").startsWith("private, no-store"), true);
  assert.equal(blockedData.maintenance, true);
  assert.equal(h.calls.dashboard, 0);
  assert.equal(h.calls.probes.length, 0);

  const admin = harness({ siteMaintenance: true, admin: true });
  const visible = await admin.status.GET(admin.request());
  assert.equal(visible.status, 200);
  assert.equal(admin.calls.dashboard, 1);
});

test("an empty or stale monitor snapshot is shown as unknown, never as green", async () => {
  const h = harness({ snapshot: [], monitorCheckedAt: null });
  const data = await (await h.status.GET(h.request())).json();
  assert.equal(data.monitorStatus, "unknown");
  assert.equal(data.services[0].status, "unknown");
  assert.equal(data.services[0].checkedAt, null);
  assert.equal(data.services[0].responseMs, null);
});

test("monitor owns normal checks, maintenance states, history writes, heartbeat snapshot and scheduling", async () => {
  const services = [service("fivem", { kind: "fivem" }), service("maintenance", { maintenance: 1, maintenanceMessage: "Onderhoud" }), service("paused", { paused: 1 })];
  const h = harness({ services });
  const response = await h.monitor.POST(h.monitorRequest());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.checkedServices, 3);
  assert.equal(typeof data.heartbeatAt, "number");
  assert.equal(h.calls.services, 1);
  assert.equal(h.calls.schedules, 1);
  assert.equal(h.calls.recorded.length, 3);
  assert.equal(h.calls.incidents.length, 3);
  assert.equal(h.calls.snapshots.length, 1);
  const byId = Object.fromEntries(h.calls.snapshots[0].snapshot.map((item) => [item.id, item]));
  assert.equal(byId.fivem.status, "operational");
  assert.equal(byId.fivem.players, 5);
  assert.equal(byId.maintenance.status, "maintenance");
  assert.equal(byId.maintenance.message, "Onderhoud");
  assert.equal(byId.paused.status, "down");
  assert.equal(h.calls.probes.length, 1);
  assert.equal(new URL(h.calls.probes[0]).origin, "https://fivem.example");
  assert.ok(new URL(h.calls.probes[0]).searchParams.has("t"));
  assert.equal(h.calls.prune.length, 1);
  assert.deepEqual(h.calls.releases, ["test-lease"]);
});

test("three confirmed failures and recovery transitions each send only one Discord alert", async () => {
  const services = [service("broken"), service("restored")];
  const h = harness({
    services, webhook: true, probeStatuses: { broken: 500 }, failures: { broken: 3 },
    incidentChanges: { broken: [{ kind: "started" }, null], restored: [{ kind: "recovered" }, null] },
  });
  await h.monitor.POST(h.monitorRequest());
  await h.monitor.POST(h.monitorRequest());
  assert.equal(h.calls.incidents.filter(({ id, status }) => id === "broken" && status === "down").length, 2);
  assert.equal(h.calls.alerts.length, 2);
  assert.deepEqual(h.calls.alerts.map((alert) => alert.embeds[0].color).sort(), [0x27bc71, 0xe35454].sort());
  assert.equal(h.calls.snapshots.length, 2);
});

test("a second monitor skips while another worker holds the database lease", async () => {
  const h = harness({ leaseBusy: true });
  const response = await h.monitor.POST(h.monitorRequest());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.skipped, true);
  assert.equal(h.calls.services, 0);
  assert.equal(h.calls.recorded.length, 0);
  assert.equal(h.calls.incidents.length, 0);
  assert.equal(h.calls.snapshots.length, 0);
  assert.equal(h.calls.releases.length, 0);
});

test("monitor coordination enforces a shared cooldown after a completed check", async () => {
  let now = 1_000_000;
  let sequence = 0;
  class TestDate extends Date { static now() { return now; } }
  const exports = {};
  const dependencies = {
    "./database-availability": { assertDatabaseAvailable() {}, clearDatabaseUnavailable() {}, markDatabaseUnavailable: (error) => error },
    "./database-client": { createDatabaseClient: async () => { throw new Error("Database should not be used in this test"); } },
  };
  vm.runInNewContext(source("app/lib/server.ts"), {
    exports,
    require: (name) => { assert.ok(name in dependencies, `Unexpected import: ${name}`); return dependencies[name]; },
    process: { env: {} }, Date: TestDate, TextEncoder, crypto: { randomUUID: () => `lease-${++sequence}` },
  }, { filename: "app/lib/server.ts" });
  const first = await exports.acquireMonitorLease();
  assert.equal(first, "lease-1");
  assert.equal(await exports.acquireMonitorLease(), null);
  assert.equal(await exports.recordMonitorSnapshot(first, now, []), true);
  assert.equal(await exports.acquireMonitorLease(), null);
  now += 8_001;
  assert.ok(await exports.acquireMonitorLease());
});

test("wrong monitor secret is rejected before it can acquire a lease or check services", async () => {
  const h = harness();
  const response = await h.monitor.POST(h.monitorRequest("wrong"));
  assert.equal(response.status, 401);
  assert.equal(h.calls.leases, 0);
  assert.equal(h.calls.services, 0);
});

test("database failures return a generic retry response and never expose private connection details", async () => {
  const h = harness({ databaseError: new Error("SQL connection password private quota") });
  const response = await h.status.GET(h.request());
  const data = await response.json();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "300");
  assert.equal(data.unavailable, true);
  assert.equal("services" in data, false);
  assert.doesNotMatch(JSON.stringify(data), /SQL|password|private|quota/);
  assert.equal(h.calls.probes.length, 0);
  assert.equal(h.calls.recorded.length, 0);
});
