import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
  const calls = { settings: 0, services: 0, monitorHeartbeat: 0, history: [], recorded: [], incidents: [], listedIncidents: 0, announcements: 0, prune: [], probes: [], alerts: [], heartbeatWrites: [] };
  const environment = { MONITOR_SECRET: options.secret ?? "test-monitor-secret", ...(options.webhook ? { DISCORD_WEBHOOK_URL: "https://discord.example/webhook" } : {}) };
  const imports = {
    "@/app/lib/server": {
      getSiteSettings: async () => { calls.settings++; if (options.settingsError) throw options.settingsError; return { maintenance: options.siteMaintenance ?? false }; },
      hasAdminSession: async () => options.admin ?? false,
      listServices: async () => { calls.services++; if (options.databaseError) throw options.databaseError; return services; },
      getMonitorHeartbeat: async () => { calls.monitorHeartbeat++; return Date.now(); },
      recordHistory: async (id, bucket, checkedAt, result) => { calls.recorded.push({ id, bucket, checkedAt, ...result }); },
      getHistory: async (id, range) => { calls.history.push({ id, range }); return [{ status: "operational", checkedAt: Date.now(), message: "OK" }]; },
      recordIncidentState: async (current, status, message) => { calls.incidents.push({ id: current.id, status, message }); return options.incidentChanges?.[current.id] ?? null; },
      listIncidents: async () => { calls.listedIncidents++; return []; },
      listAnnouncements: async () => { calls.announcements++; return options.announcements ?? []; },
      pruneHistory: async (before) => { calls.prune.push(before); },
      recordMonitorHeartbeat: async (at) => { calls.heartbeatWrites.push(at); },
    },
    "@/app/lib/database-availability": { markDatabaseUnavailable: () => ({ retryAfterSeconds: 300 }) },
  };

  function load(path) {
    const exports = {};
    vm.runInNewContext(source(path), {
      exports,
      require: (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; },
      Request, Response, URL, AbortController, Date, Map, setTimeout, clearTimeout,
      process: { env: environment },
      fetch: async (url, init = {}) => {
        const target = String(url);
        if (target === environment.DISCORD_WEBHOOK_URL) {
          calls.alerts.push(JSON.parse(init.body));
          return new Response(null, { status: 204 });
        }
        calls.probes.push(target);
        if (target === "https://overheid.amsterdamrp.nl/api/site-status") {
          return Response.json({ maintenance: { enabled: true, reason: "Overheidsportaal wordt bijgewerkt." } });
        }
        const matching = services.find((entry) => target.startsWith(entry.endpoint));
        if (matching?.kind === "fivem") return Response.json({ clients: 5, sv_maxclients: 128 });
        return new Response("OK", { status: options.probeStatuses?.[matching?.id] ?? 200 });
      },
    }, { filename: path });
    return exports;
  }

  imports["@/app/lib/announcement-status"] = load("app/lib/announcement-status.ts");
  imports["@/app/lib/website-maintenance"] = load("app/lib/website-maintenance.ts");
  const status = load("app/api/status/route.ts");
  imports["../status/route"] = status;
  const monitor = load("app/api/monitor/route.ts");
  return {
    calls, services, status, monitor,
    request: (authenticated = false, range = "1h", bearer = environment.MONITOR_SECRET) => new Request(`https://status.example/api/status?range=${range}`, { headers: authenticated ? { Authorization: `Bearer ${bearer}` } : {} }),
    monitorRequest: (bearer = environment.MONITOR_SECRET) => new Request("https://status.example/api/monitor", { method: "POST", headers: { Authorization: `Bearer ${bearer}` } }),
  };
}

test("authenticated monitor skips every discarded dashboard read and keeps probe writes", async () => {
  const h = harness({
    settingsError: new Error("The monitor must not read site settings"),
    services: [service("fivem", { kind: "fivem" }), service("government", { endpoint: "https://overheid.amsterdamrp.nl/" }), service("paused", { paused: 1 })],
  });
  const response = await h.status.GET(h.request(true));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Object.keys(data).sort(), ["checkedAt", "services"]);
  assert.deepEqual(data.services, h.services.map(({ id }) => ({ id })));
  assert.equal(typeof data.checkedAt, "number");
  assert.equal(h.calls.settings, 0);
  assert.equal(h.calls.monitorHeartbeat, 0);
  assert.equal(h.calls.history.length, 0);
  assert.equal(h.calls.listedIncidents, 0);
  assert.equal(h.calls.announcements, 0);
  assert.equal(h.calls.recorded.length, 3);
  assert.equal(h.calls.incidents.length, 3);
  assert.equal(h.calls.prune.length, 1);
  assert.equal(h.calls.recorded.find(({ id }) => id === "government").status, "maintenance");
  assert.equal(h.calls.recorded.find(({ id }) => id === "paused").status, "down");
  assert.ok(h.calls.probes.includes("https://overheid.amsterdamrp.nl/api/site-status"));
});

test("monitor retains incident transitions and Discord alerts", async () => {
  const h = harness({
    webhook: true,
    services: [service("broken"), service("maintenance", { maintenance: 1, maintenanceMessage: "Gepland onderhoud." }), service("recovered")],
    probeStatuses: { broken: 500 },
    incidentChanges: { broken: { kind: "started" }, maintenance: { kind: "updated", previousStatus: "down" }, recovered: { kind: "recovered" } },
  });
  const response = await h.status.GET(h.request(true));
  assert.equal(response.status, 200);
  assert.equal(h.calls.alerts.length, 3);
  assert.deepEqual(h.calls.alerts.map((alert) => alert.embeds[0].color).sort(), [0x27bc71, 0xe35454, 0xe5a12b].sort());
  assert.equal(h.calls.recorded.length, 3);
  assert.equal(h.calls.incidents.length, 3);
  assert.equal(h.calls.history.length, 0);
});

test("public response keeps history, heartbeat, announcements and explicit maintenance priority", async () => {
  const h = harness({
    services: [service("website"), service("maintenance", { maintenance: 1, maintenanceMessage: "Expliciet onderhoud." }), service("government", { endpoint: "https://overheid.amsterdamrp.nl/" }), service("notice")],
    announcements: [announcement(["website", "maintenance", "government"]), announcement(["notice"], { kind: "notice" })],
  });
  const response = await h.status.GET(h.request(false, "24h"));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.range, "24h");
  assert.equal(data.checkIntervalSeconds, 5);
  assert.equal(data.monitorStatus, "active");
  assert.equal(h.calls.settings, 1);
  assert.equal(h.calls.monitorHeartbeat, 1);
  assert.equal(h.calls.history.length, 4);
  assert.ok(h.calls.history.every(({ range }) => range === "24h"));
  assert.equal(h.calls.listedIncidents, 1);
  assert.equal(h.calls.announcements, 1);
  assert.equal(data.services.find(({ id }) => id === "website").status, "down");
  assert.equal(data.services.find(({ id }) => id === "maintenance").status, "maintenance");
  assert.equal(data.services.find(({ id }) => id === "maintenance").message, "Expliciet onderhoud.");
  assert.equal(data.services.find(({ id }) => id === "government").status, "maintenance");
  assert.equal(data.services.find(({ id }) => id === "government").message, "Overheidsportaal wordt bijgewerkt.");
  assert.equal(data.services.find(({ id }) => id === "notice").status, "operational");
  assert.ok(data.services.every(({ history, uptime }) => history.length === 1 && uptime === 100));
  assert.equal(h.calls.recorded.find(({ id }) => id === "website").status, "operational");
});

test("wrong or missing monitor secrets cannot select the compact path or bypass maintenance", async () => {
  for (const secret of ["test-monitor-secret", ""]) {
    const h = harness({ secret, siteMaintenance: true });
    const response = await h.status.GET(h.request(true, "1h", "wrong"));
    const data = await response.json();
    assert.equal(response.status, 503);
    assert.equal(data.maintenance, true);
    assert.equal("services" in data, false);
    assert.equal(h.calls.settings, 1);
    assert.equal(h.calls.services, 0);
    assert.equal(h.calls.recorded.length, 0);
  }
  const h = harness();
  const data = await (await h.status.GET(h.request(true, "invalid", "wrong"))).json();
  assert.equal(data.range, "1h");
  assert.equal(h.calls.history.length, 1);
  assert.ok("announcements" in data && "monitorCheckedAt" in data);
});

test("database failures remain generic and keep the retry contract", async () => {
  const h = harness({ databaseError: new Error("SQL connection password private quota") });
  const response = await h.status.GET(h.request(true));
  const data = await response.json();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "300");
  assert.equal(data.unavailable, true);
  assert.equal("services" in data, false);
  assert.doesNotMatch(JSON.stringify(data), /SQL|password|private|quota/);
  assert.equal(h.calls.recorded.length, 0);
  assert.equal(h.calls.history.length, 0);
});

test("monitor endpoint counts compact services and writes the heartbeat", async () => {
  const h = harness({ services: [service("first"), service("second")], siteMaintenance: true });
  const response = await h.monitor.POST(h.monitorRequest());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.checkedServices, 2);
  assert.equal(typeof data.checkedAt, "number");
  assert.equal(typeof data.heartbeatAt, "number");
  assert.equal(h.calls.heartbeatWrites.length, 1);
  assert.equal(h.calls.history.length, 0);
  assert.equal(h.calls.monitorHeartbeat, 0);
  assert.equal(h.calls.listedIncidents, 0);
  assert.equal(h.calls.announcements, 0);
  const readsBefore = h.calls.services;
  assert.equal((await h.monitor.POST(h.monitorRequest("wrong"))).status, 401);
  assert.equal(h.calls.services, readsBefore);
});
