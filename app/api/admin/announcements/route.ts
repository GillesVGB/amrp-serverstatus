import { hasAdminSession, isSameOrigin, listAnnouncements, listServices, saveAnnouncement, validateAnnouncement } from "@/app/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await hasAdminSession(request)) return Response.json({ error: "Log in om meldingen te beheren." }, { status: 401 });
  try {
    const announcements = await listAnnouncements(true);
    return Response.json({ announcements }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Meldingen konden niet worden geladen." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await hasAdminSession(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  try {
    const draft = validateAnnouncement(await request.json());
    const services = await listServices(true);
    const knownServices = new Map(services.map((service) => [service.id, service.name]));
    if (draft.serviceIds.some((id) => !knownServices.has(id))) throw new Error("Een geselecteerde dienst bestaat niet meer. Vernieuw het beheerpaneel.");
    const announcement = await saveAnnouncement({
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      published: draft.published,
      affectedServices: draft.serviceIds.map((id) => ({ id, name: knownServices.get(id)! })),
    });
    if (!announcement) throw new Error("De melding kon niet worden aangemaakt.");
    return Response.json({ announcement }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "De melding kon niet worden opgeslagen." }, { status: 400 });
  }
}
