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
    const saved = await saveService(service, id);
    return Response.json({ service: saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "De dienst kon niet worden bijgewerkt." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await authorize(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  const { id } = await context.params;
  if (!await deleteService(id)) return Response.json({ error: "Deze dienst bestaat niet meer." }, { status: 404 });
  return Response.json({ ok: true });
}
