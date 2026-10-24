import { hasAdminSession, isSameOrigin, listServices, saveService } from "@/app/lib/server";

export const dynamic = "force-dynamic";
const origin = "https://overheid.amsterdamrp.nl";
const headers = { "Cache-Control": "no-store" };
type PortalResponse = { maintenance?: { enabled: boolean; reason: string; updatedAt: string | null } };

export async function GET(request: Request) {
  if (!await hasAdminSession(request)) return Response.json({ error: "Log eerst in." }, { status: 401, headers });
  if (!process.env.OVERHEID_STATUS_CONTROL_SECRET) return Response.json({ error: "De onderhoudskoppeling is nog niet ingesteld." }, { status: 503, headers });
  try {
    const response = await fetch(`${origin}/api/site-status`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
    const data = await response.json() as PortalResponse;
    if (!response.ok || typeof data.maintenance?.enabled !== "boolean") throw new Error();
    return Response.json({ maintenance: data.maintenance }, { headers });
  } catch {
    return Response.json({ error: "De onderhoudsstatus van het overheidsportaal kon niet worden opgehaald. Probeer opnieuw." }, { status: 502, headers });
  }
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst." }, { status: 403, headers });
  if (!await hasAdminSession(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401, headers });
  const secret = process.env.OVERHEID_STATUS_CONTROL_SECRET;
  if (!secret) return Response.json({ error: "De onderhoudskoppeling is nog niet ingesteld." }, { status: 503, headers });
  let body: { enabled?: unknown; reason?: unknown } | null;
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Ongeldig verzoek." }, { status: 400, headers }); }
  if (!body || typeof body.enabled !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length > 500 || (body.enabled && body.reason.trim().length < 5))
    return Response.json({ error: "Vul een onderhoudsreden in van 5 tot 500 tekens." }, { status: 400, headers });
  try {
    const response = await fetch(`${origin}/api/status-control/maintenance`, {
      method: "PUT", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: body.enabled, reason: body.reason.trim() }),
    });
    const data = await response.json() as PortalResponse;
    if (!response.ok || data.maintenance?.enabled !== body.enabled) throw new Error();
    let warning: string | undefined;
    try {
      for (const service of await listServices(true)) {
        const url = new URL(service.endpoint);
        if (service.kind === "website" && url.hostname === "overheid.amsterdamrp.nl")
          await saveService({ ...service, maintenance: body.enabled ? 1 : 0, maintenanceMessage: body.enabled ? body.reason.trim() : "" }, service.id);
      }
    } catch { warning = "Het overheidsportaal is aangepast, maar de handmatige onderhoudsstatus op de statuspagina kon niet worden bijgewerkt."; }
    return Response.json({ maintenance: data.maintenance, warning }, { headers });
  } catch {
    return Response.json({ error: "Geen bevestiging van het overheidsportaal ontvangen. De wijziging kan al uitgevoerd zijn. Ververs de onderhoudsstatus voordat je opnieuw probeert." }, { status: 502, headers });
  }
}
