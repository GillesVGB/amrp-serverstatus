import { listServices, pruneHistory, recordHistory, type ServiceRow, type ServiceStatus } from "@/app/lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Probe = { status: ServiceStatus; message: string; responseMs: number | null; players: number | null; maxPlayers: number | null };

async function probe(service: ServiceRow): Promise<Probe> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3800);
  const startedAt = Date.now();
  try {
    const url = service.kind === "fivem" ? `${service.endpoint}${service.endpoint.includes("?") ? "&" : "?"}t=${Date.now()}` : service.endpoint;
    const response = await fetch(url, { method: "GET", cache: "no-store", redirect: "follow", signal: controller.signal, headers: { "User-Agent": "AmsterdamRoleplay-Status/1.0", Accept: service.kind === "fivem" ? "application/json" : "*/*" } });
    const responseMs = Date.now() - startedAt;
    if (service.kind === "fivem") {
      if (!response.ok) return { status: response.status >= 500 ? "down" : "degraded", message: `FiveM gaf HTTP ${response.status} terug`, responseMs, players: null, maxPlayers: null };
      const data = await response.json() as { clients?: number | string; sv_maxclients?: number | string; hostname?: string };
      const players = Number(data.clients);
      const maxPlayers = Number(data.sv_maxclients);
      if (!Number.isFinite(players) || !Number.isFinite(maxPlayers)) return { status: "degraded", message: "FiveM reageert, maar de spelersgegevens zijn ongeldig", responseMs, players: null, maxPlayers: null };
      return { status: "operational", message: data.hostname || "FiveM-server reageert", responseMs, players, maxPlayers };
    }
    if (response.status >= 500) return { status: "down", message: `Server gaf HTTP ${response.status} terug`, responseMs, players: null, maxPlayers: null };
    if (response.status >= 400) return { status: "degraded", message: `Adres reageert met HTTP ${response.status}`, responseMs, players: null, maxPlayers: null };
    return { status: "operational", message: "Adres bereikbaar", responseMs, players: null, maxPlayers: null };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));
    return { status: service.kind === "http" ? "unknown" : "down", message: service.kind === "http" ? (timedOut ? "Geen HTTP-antwoord op dit adres; de bot zelf is niet bevestigd" : "Geen HTTP-verbinding met dit adres") : (timedOut ? "Controle verliep na 4,2 seconden" : "Adres niet bereikbaar"), responseMs: null, players: null, maxPlayers: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET() {
  const checkedAt = Date.now();
  try {
    const services = await listServices();
    const results = await Promise.all(services.map(async (service) => {
      const current: Probe = service.paused === 1
        ? { status: "down", message: "Deze dienst is gepauzeerd door een beheerder.", responseMs: null, players: null, maxPlayers: null }
        : service.maintenance === 1
          ? { status: "maintenance", message: service.maintenanceMessage || "Deze dienst is gepland in onderhoud.", responseMs: null, players: null, maxPlayers: null }
        : await probe(service);
      const bucket = Math.floor(checkedAt / 5000);
      const history = await recordHistory(service.id, bucket, checkedAt, current);
      const known = history.filter((item) => item.status !== "unknown" && item.status !== "maintenance");
      const upCount = known.filter((item) => item.status === "operational" || item.status === "degraded").length;
      const uptime = known.length ? Math.round((upCount / known.length) * 10000) / 100 : null;
      const currentMinute = Math.floor(checkedAt / 60000);
      const minuteSamples = Array.from({ length: 60 }, (_, index) => {
        const minute = currentMinute - 59 + index;
        const samples = history.filter((sample) => Math.floor(sample.checkedAt / 60000) === minute);
        if (!samples.length) return null;
        const status: ServiceStatus = samples.some((sample) => sample.status === "down")
          ? "down"
          : samples.some((sample) => sample.status === "degraded")
            ? "degraded"
          : samples.some((sample) => sample.status === "maintenance")
            ? "maintenance"
            : samples.some((sample) => sample.status === "operational")
              ? "operational"
              : "unknown";
        const detail = [...samples].reverse().find((sample) => sample.status === status) ?? samples[samples.length - 1];
        return { status, checkedAt: detail.checkedAt, message: detail.message };
      });
      return {
        id: service.id,
        name: service.name,
        category: service.category,
        kind: service.kind,
        enabled: Boolean(service.enabled),
        paused: Boolean(service.paused),
        maintenance: Boolean(service.maintenance),
        maintenanceMessage: service.maintenanceMessage,
        ...current,
        checkedAt,
        history: minuteSamples,
        uptime,
      };
    }));
    await pruneHistory(checkedAt - 60 * 60 * 1000);
    return Response.json({ services: results, checkedAt, checkIntervalSeconds: 5 }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Statuscontrole niet beschikbaar." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
