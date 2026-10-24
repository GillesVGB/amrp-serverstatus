import { getHistory, getMonitorHeartbeat, getSiteSettings, hasAdminSession, listAnnouncements, listIncidents, listServices, pruneHistory, recordHistory, recordIncidentState, type HistoryRange, type ServiceRow, type ServiceStatus } from "@/app/lib/server";
import { getAnnouncedOutages, announcedOutageReason } from "@/app/lib/announcement-status";
import { websiteMaintenanceReason } from '@/app/lib/website-maintenance';
import { markDatabaseUnavailable } from "@/app/lib/database-availability";

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
    if (service.kind === 'website') {
      const reason = await websiteMaintenanceReason(service.endpoint, response, fetch, controller.signal);
      if (reason !== null) return {status:'maintenance',message:reason,responseMs:Date.now() - startedAt,players:null,maxPlayers:null};
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

const validRanges: HistoryRange[] = ["1h", "24h"];

async function sendDiscordAlert(serviceName: string, status: ServiceStatus, reason: string, event: "started" | "maintenance" | "recovered") {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);
  const title = event === "recovered" ? "Dienst hersteld" : event === "maintenance" || status === "maintenance" ? "Onderhoud gestart" : "Storing gedetecteerd";
  const color = event === "recovered" ? 0x27bc71 : status === "maintenance" ? 0xe5a12b : 0xe35454;
  try {
    await fetch(webhook, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `Amsterdam Roleplay · ${title}`,
          color,
          fields: [
            { name: "Dienst", value: serviceName.slice(0, 100), inline: true },
            { name: "Status", value: status === "operational" ? "Operationeel" : status === "maintenance" ? "Onderhoud" : status === "degraded" ? "Gedeeltelijke storing" : "Storing", inline: true },
            { name: event === "recovered" ? "Herstel" : "Melding", value: reason.slice(0, 900) || "Geen verdere details beschikbaar." },
          ],
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch {
    // Status checks must keep working if Discord is unavailable.
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: Request) {
  const checkedAt = Date.now();
  try {
    const monitorSecret = process.env.MONITOR_SECRET;
    const isMonitor = Boolean(monitorSecret) && request.headers.get("authorization") === `Bearer ${monitorSecret}`;
    const settings = isMonitor ? null : await getSiteSettings();
    if (settings?.maintenance && !await hasAdminSession(request)) {
      return Response.json({ maintenance: true, reason: settings.reason, error: "De statuswebsite is tijdelijk in onderhoud." }, {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      });
    }
    const requestedRange = new URL(request.url).searchParams.get("range") as HistoryRange | null;
    const range: HistoryRange = requestedRange && validRanges.includes(requestedRange) ? requestedRange : "1h";
    const [services, monitorCheckedAt] = await Promise.all([
      listServices(),
      isMonitor ? Promise.resolve(null) : getMonitorHeartbeat(),
    ]);
    const results = await Promise.all(services.map(async (service) => {
      const current: Probe = service.paused === 1
        ? { status: "down", message: "Deze dienst is gepauzeerd door een beheerder.", responseMs: null, players: null, maxPlayers: null }
        : service.maintenance === 1
          ? { status: "maintenance", message: service.maintenanceMessage || "Deze dienst is gepland in onderhoud.", responseMs: null, players: null, maxPlayers: null }
        : await probe(service);
      const bucket = Math.floor(checkedAt / 300_000);
      await recordHistory(service.id, bucket, checkedAt, current);
      const [history, incidentChange] = await Promise.all([
        isMonitor ? Promise.resolve([]) : getHistory(service.id, range, checkedAt),
        recordIncidentState(service, current.status, current.message, checkedAt),
      ]);
      if (incidentChange?.kind === "started") {
        await sendDiscordAlert(service.name, current.status, current.message, current.status === "maintenance" ? "maintenance" : "started");
      } else if (incidentChange?.kind === "updated" && ((current.status === "maintenance" && incidentChange.previousStatus !== "maintenance") || (incidentChange.previousStatus === "maintenance" && current.status !== "maintenance"))) {
        await sendDiscordAlert(service.name, current.status, current.message, current.status === "maintenance" ? "maintenance" : "started");
      } else if (incidentChange?.kind === "recovered") {
        await sendDiscordAlert(service.name, "operational", "De dienst reageert weer normaal.", "recovered");
      }
      const known = history.filter((item): item is NonNullable<typeof item> => item !== null && item.status !== "unknown" && item.status !== "maintenance");
      const upCount = known.filter((item) => item.status === "operational" || item.status === "degraded").length;
      const uptime = known.length ? Math.round((upCount / known.length) * 10000) / 100 : null;
      return {
        id: service.id,
        name: service.name,
        category: service.category,
        kind: service.kind,
        enabled: Boolean(service.enabled),
        paused: Boolean(service.paused),
        maintenance: Boolean(service.maintenance || current.status === 'maintenance'),
        maintenanceMessage: current.status === 'maintenance' ? current.message : service.maintenanceMessage,
        ...current,
        checkedAt,
        history,
        uptime,
      };
    }));
    if (isMonitor) {
      await pruneHistory(checkedAt - 24 * 60 * 60 * 1000);
      // The worker needs only the checked count; do not read discarded dashboard data.
      return Response.json({ services: results.map(({ id }) => ({ id })), checkedAt }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const [incidents, announcements] = await Promise.all([listIncidents(), listAnnouncements()]);
    const announcedOutages = getAnnouncedOutages(announcements);
    const publicResults = results.map((service) => {
      const reason = announcedOutageReason(service.id, service.status, announcedOutages);
      return reason ? { ...service, status: 'down' as const, message: reason } : service;
    });
    await pruneHistory(checkedAt - 24 * 60 * 60 * 1000);
    const monitorStatus = monitorCheckedAt === null ? "unknown" : Date.now() - monitorCheckedAt > 20_000 ? "stale" : "active";
    return Response.json({ services: publicResults, incidents, announcements, checkedAt, monitorCheckedAt, monitorStatus, range, checkIntervalSeconds: 5 }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" } });
  } catch (error) {
    const failure = markDatabaseUnavailable(error);
    return Response.json({ unavailable: true, error: "De statusgegevens zijn tijdelijk niet beschikbaar. We proberen het later opnieuw." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(failure.retryAfterSeconds) } });
  }
}
