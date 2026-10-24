import { getSiteSettings, hasAdminSession, isSameOrigin, saveSiteSettings } from "@/app/lib/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!await hasAdminSession(request)) return Response.json({ error: "Log in om de website-instellingen te beheren." }, { status: 401, headers });
  try {
    const settings = await getSiteSettings();
    return Response.json({ settings }, { headers });
  } catch {
    return Response.json({ error: "De website-instellingen konden niet worden geladen." }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403, headers });
  if (!await hasAdminSession(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401, headers });

  let maintenance: boolean;
  let reason: string;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["maintenance", "reason"].includes(key)) || !("maintenance" in body) || typeof body.maintenance !== "boolean") {
      return Response.json({ error: "Geef onderhoud op als true of false." }, { status: 400, headers });
    }
    maintenance = body.maintenance;
    if (!("reason" in body) || typeof body.reason !== "string" || body.reason.trim().length > 500 || (maintenance && body.reason.trim().length < 5)) {
      return Response.json({ error: "Vul een onderhoudsreden in van 5 tot 500 tekens." }, { status: 400, headers });
    }
    reason = body.reason.trim();
  } catch {
    return Response.json({ error: "Ongeldige website-instellingen." }, { status: 400, headers });
  }

  try {
    const settings = await saveSiteSettings(maintenance, reason);
    return Response.json({ settings }, { headers });
  } catch {
    return Response.json({ error: "De website-instellingen konden niet worden opgeslagen." }, { status: 503, headers });
  }
}
