import { acquireMonitorLease, listServices, pruneHistory, recordHistory, recordIncidentState, recordMonitorSnapshot, releaseMonitorLease, type MonitorSnapshot, type ServiceRow, type ServiceStatus } from "@/app/lib/server";
import { confirmAutomaticProbe } from "@/app/lib/admin-storage";
import { runScheduledMaintenance } from "@/app/lib/admin-operations";
import { websiteMaintenanceReason } from "@/app/lib/website-maintenance";
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
    if (service.kind === "website") {
      const reason = await websiteMaintenanceReason(service.endpoint, response, fetch, controller.signal);
      if (reason !== null) return { status: "maintenance", message: reason, responseMs: Date.now() - startedAt, players: null, maxPlayers: null };
    }
    if (response.status >= 500) return { status: "down", message: `Server gaf HTTP ${response.status} terug`, responseMs, players: null, maxPlayers: null };
    if (response.status >= 400) return { status: "degraded", message: `Adres reageert met HTTP ${response.status}`, responseMs, players: null, maxPlayers: null };
    return { status: "operational", message: "Adres bereikbaar", responseMs, players: null, maxPlayers: null };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));
    return {
      status: service.kind === "http" ? "unknown" : "down",
      message: service.kind === "http" ? (timedOut ? "Geen HTTP-antwoord op dit adres; de bot zelf is niet bevestigd" : "Geen HTTP-verbinding met dit adres") : (timedOut ? "Controle verliep na 4,2 seconden" : "Adres niet bereikbaar"),
      responseMs: null, players: null, maxPlayers: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendDiscordAlert(serviceName: string, status: ServiceStatus, reason: string, event: "started" | "maintenance" | "recovered") {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800);
  const title = event === "recovered" ? "Dienst hersteld" : event === "maintenance" || status === "maintenance" ? "Onderhoud gestart" : "Storing gedetecteerd";
  const color = event === "recovered" ? 0x27bc71 : status === "maintenance" ? 0xe5a12b : 0xe35454;
  try {
    await fetch(webhook, {
      method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `Amsterdam Roleplay · ${title}`, color,
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
    // The monitoring cycle must still complete when Discord is unavailable.
  } finally {
    clearTimeout(timeoutId);
  }
}

async function publishIncidentTransition(service: ServiceRow, current: Probe, checkedAt: number) {
  const incidentChange = await recordIncidentState(service, current.status, current.message, checkedAt);
  if (incidentChange?.kind === "started") {
    await sendDiscordAlert(service.name, current.status, current.message, current.status === "maintenance" ? "maintenance" : "started");
  } else if (incidentChange?.kind === "updated" && ((current.status === "maintenance" && incidentChange.previousStatus !== "maintenance") || (incidentChange.previousStatus === "maintenance" && current.status !== "maintenance"))) {
    await sendDiscordAlert(service.name, current.status, current.message, current.status === "maintenance" ? "maintenance" : "started");
  } else if (incidentChange?.kind === "recovered") {
    await sendDiscordAlert(service.name, "operational", "De dienst reageert weer normaal.", "recovered");
  }
}

export async function POST(request: Request) {
  const secret = process.env.MONITOR_SECRET;
  if (!secret) return Response.json({ error: "Achtergrondcontrole is niet geconfigureerd." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Niet geautoriseerd." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  let lease: string | null = null;
  try {
    lease = await acquireMonitorLease();
    if (!lease) {
      return Response.json({ ok: true, skipped: true, checkedAt: Date.now(), heartbeatAt: null, checkedServices: 0 }, { headers: { "Cache-Control": "no-store" } });
    }

    try { await runScheduledMaintenance(); } catch { console.error("Onderhoudsplanning kon deze ronde niet worden uitgevoerd."); }
    const services = await listServices();
    const checkedAt = Date.now();
    const snapshots = await Promise.all(services.map(async (service): Promise<MonitorSnapshot> => {
      let current: Probe = service.paused === 1
        ? { status: "down", message: "Deze dienst is gepauzeerd door een beheerder.", responseMs: null, players: null, maxPlayers: null }
        : service.maintenance === 1
          ? { status: "maintenance", message: service.maintenanceMessage || "Deze dienst is gepland in onderhoud.", responseMs: null, players: null, maxPlayers: null }
          : await probe(service);
      const failures = await confirmAutomaticProbe(service.id, service.paused || service.maintenance ? "maintenance" : current.status, checkedAt);
      if (!service.paused && !service.maintenance && (current.status === "down" || current.status === "degraded") && failures < 3) {
        current = { ...current, status: "unknown", message: `Controle wordt bevestigd (${failures}/3): ${current.message}` };
      }
      await recordHistory(service.id, Math.floor(checkedAt / 60_000), checkedAt, current);
      await publishIncidentTransition(service, current, checkedAt);
      return { id: service.id, ...current, checkedAt };
    }));
    await pruneHistory(checkedAt - 24 * 60 * 60 * 1000);
    const saved = await recordMonitorSnapshot(lease, checkedAt, snapshots);
    if (!saved) throw new Error("De monitorlease is verlopen voordat de resultaten zijn opgeslagen.");
    return Response.json({ ok: true, checkedAt, heartbeatAt: checkedAt, checkedServices: snapshots.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = markDatabaseUnavailable(error);
    return Response.json({ ok: false, error: "De monitor kon deze controleronde niet opslaan." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": String(failure.retryAfterSeconds) } });
  } finally {
    if (lease) {
      try { await releaseMonitorLease(lease); } catch { /* An expired lease will be available on the next cycle. */ }
    }
  }
}
