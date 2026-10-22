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
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("maintenance" in body) || typeof body.maintenance !== "boolean") {
      return Response.json({ error: "Geef onderhoud op als true of false." }, { status: 400, headers });
    }
    maintenance = body.maintenance;
  } catch {
    return Response.json({ error: "Ongeldige website-instellingen." }, { status: 400, headers });
  }

  try {
    const settings = await saveSiteSettings(maintenance);
    return Response.json({ settings }, { headers });
  } catch {
    return Response.json({ error: "De website-instellingen konden niet worden opgeslagen." }, { status: 503, headers });
  }
}
