import { logAdminAction } from "@/app/lib/admin-storage";
import { deleteAnnouncement, hasAdminSession, isSameOrigin, listAnnouncements, listServices, saveAnnouncement, validateAnnouncement } from "@/app/lib/server";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await hasAdminSession(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  try {
    const { id } = await context.params;
    const draft = validateAnnouncement(await request.json());
    const [services, announcements] = await Promise.all([listServices(true), listAnnouncements(true)]);
    const knownServices = new Map(services.map((service) => [service.id, service.name]));
    const existingAnnouncement = announcements.find((announcement) => announcement.id === id);
    if (draft.serviceIds.some((serviceId) => !knownServices.has(serviceId) && !existingAnnouncement?.affectedServices.some((service) => service.id === serviceId))) throw new Error("Een geselecteerde dienst bestaat niet meer. Vernieuw het beheerpaneel.");
    const announcement = await saveAnnouncement({
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      published: draft.published,
      affectedServices: draft.serviceIds.map((serviceId) => ({ id: serviceId, name: knownServices.get(serviceId) ?? existingAnnouncement?.affectedServices.find((service) => service.id === serviceId)?.name ?? serviceId })),
    }, id);
    if (!announcement) return Response.json({ error: "Deze melding bestaat niet meer." }, { status: 404 });
    await logAdminAction(announcement.published ? "Melding gewijzigd · gepubliceerd" : "Melding gewijzigd · concept", announcement.title);
    return Response.json({ announcement }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "De melding kon niet worden bijgewerkt." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await hasAdminSession(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  const { id } = await context.params;
  const targetName=(await listAnnouncements(true)).find(item=>item.id===id)?.title || id;
  if (!await deleteAnnouncement(id)) return Response.json({ error: "Deze melding bestaat niet meer." }, { status: 404 });
  await logAdminAction("Melding verwijderd", targetName);
  return Response.json({ ok: true });
}
