import { getSiteSettingsReadOnly, getStatusDashboardData, hasAdminSession, type HistoryRange, type MonitorSnapshot, type ServiceStatus } from "@/app/lib/server";
import { announcedOutageReason, getAnnouncedOutages } from "@/app/lib/announcement-status";
import { markDatabaseUnavailable } from "@/app/lib/database-availability";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const validRanges: HistoryRange[] = ["1h", "12h", "24h"];
const privateNoStore = { "Cache-Control": "private, no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };
const publicCache = {
  "Cache-Control": "public, max-age=15",
  "Vercel-CDN-Cache-Control": "public, s-maxage=60",
};
const validStatuses = new Set<ServiceStatus>(["operational", "degraded", "down", "unknown", "maintenance"]);
type CurrentStatus = { status: ServiceStatus; message: string; responseMs: number | null; players: number | null; maxPlayers: number | null; checkedAt: number | null };

function statusSnapshot(snapshot: MonitorSnapshot | undefined): CurrentStatus {
  if (!snapshot || !validStatuses.has(snapshot.status)) {
    return { status: "unknown" as const, message: "Wacht op de eerste controle door de statusmonitor.", responseMs: null, players: null, maxPlayers: null, checkedAt: null };
  }
  return snapshot;
}

export async function GET(request: Request) {
  try {
    const settings = await getSiteSettingsReadOnly();
    let cacheHeaders: Record<string, string> = publicCache;
    if (settings.maintenance) {
      const isAdmin = await hasAdminSession(request);
      if (!isAdmin) {
        return Response.json({ maintenance: true, reason: settings.reason, error: "De statuswebsite is tijdelijk in onderhoud." }, {
          status: 503,
          headers: { ...privateNoStore, "Retry-After": "60" },
        });
      }
      // Never put the maintenance bypass for an authenticated admin in a shared cache.
      cacheHeaders = privateNoStore;
    }

    const requestedRange = new URL(request.url).searchParams.get("range") as HistoryRange | null;
    const range: HistoryRange = requestedRange && validRanges.includes(requestedRange) ? requestedRange : "1h";
    const now = Date.now();
    const data = await getStatusDashboardData(range, now);
    const latestById = new Map(data.snapshot.map((item) => [item.id, item]));
    const services = data.services.map((service) => {
      let current = statusSnapshot(latestById.get(service.id));
      if (service.paused === 1) {
        current = { status: "down", message: "Deze dienst is gepauzeerd door een beheerder.", responseMs: null, players: null, maxPlayers: null, checkedAt: current.checkedAt };
      } else if (service.maintenance === 1) {
        current = { status: "maintenance", message: service.maintenanceMessage || "Deze dienst is gepland in onderhoud.", responseMs: null, players: null, maxPlayers: null, checkedAt: current.checkedAt };
      }
      const history = data.histories[service.id] ?? [];
      const known = history.filter((item): item is NonNullable<typeof item> => item !== null && item.status !== "unknown" && item.status !== "maintenance");
      const upCount = known.filter((item) => item.status === "operational" || item.status === "degraded").length;
      const uptime = known.length ? Math.round((upCount / known.length) * 10_000) / 100 : null;
      return {
        id: service.id,
        name: service.name,
        category: service.category,
        kind: service.kind,
        enabled: Boolean(service.enabled),
        paused: Boolean(service.paused),
        maintenance: Boolean(service.maintenance || current.status === "maintenance"),
        maintenanceMessage: current.status === "maintenance" ? current.message : service.maintenanceMessage,
        status: current.status,
        message: current.message,
        responseMs: current.responseMs,
        players: current.players,
        maxPlayers: current.maxPlayers,
        checkedAt: current.checkedAt,
        history,
        uptime,
      };
    });
    const announcedOutages = getAnnouncedOutages(data.announcements);
    const publicServices = services.map((service) => {
      const reason = announcedOutageReason(service.id, service.status, announcedOutages);
      return reason ? { ...service, status: "down" as const, message: reason } : service;
    });
    const monitorCheckedAt = data.monitorCheckedAt;
    const monitorStatus = monitorCheckedAt === null ? "unknown" : now - monitorCheckedAt > 1_800_000 ? "stale" : "active";
    return Response.json({
      services: publicServices,
      incidents: data.incidents,
      announcements: data.announcements,
      checkedAt: monitorCheckedAt ?? 0,
      monitorCheckedAt,
      monitorStatus,
      range,
      checkIntervalSeconds: 600,
    }, { headers: cacheHeaders });
  } catch (error) {
    const failure = markDatabaseUnavailable(error);
    return Response.json({ unavailable: true, error: "De statusgegevens zijn tijdelijk niet beschikbaar. We proberen het later opnieuw." }, {
      status: 503,
      headers: { ...privateNoStore, "Retry-After": String(failure.retryAfterSeconds) },
    });
  }
}
