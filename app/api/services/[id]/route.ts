import { createSettingsBackup } from "@/app/lib/admin-operations";
import { logAdminAction } from "@/app/lib/admin-storage";
import { deleteService, hasAdminSession, isSameOrigin, listServices, saveService, validateService } from "@/app/lib/server";

export const dynamic = "force-dynamic";

async function authorize(request: Request) {
  return isSameOrigin(request) && await hasAdminSession(request);
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await authorize(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  try {
    const { id } = await context.params;
    const service = validateService(await request.json());
    if (!(await listServices(true)).some((item) => item.id === id)) return Response.json({ error: "Deze dienst bestaat niet meer." }, { status: 404 });
    await createSettingsBackup("Voor wijzigen van dienst");
    const saved = await saveService(service, id);
    await logAdminAction(service.maintenance ? "Dienst gewijzigd · onderhoud actief" : service.paused ? "Dienst gepauzeerd" : "Dienst gewijzigd · actief", saved.name);
    return Response.json({ service: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "De dienst kon niet worden bijgewerkt." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await authorize(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  const { id } = await context.params;
  await createSettingsBackup("Voor verwijderen van dienst");
  const targetName = (await listServices(true)).find(item => item.id === id)?.name || id;
  if (!await deleteService(id)) return Response.json({ error: "Deze dienst bestaat niet meer." }, { status: 404 });
  await logAdminAction("Dienst verwijderd", targetName);
  return Response.json({ ok: true });
}
