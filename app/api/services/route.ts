import { createSettingsBackup } from "@/app/lib/admin-operations";
import { logAdminAction } from "@/app/lib/admin-storage";
import { hasAdminSession, isSameOrigin, listServices, saveService, validateService } from "@/app/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await hasAdminSession(request)) return Response.json({ error: "Log eerst in om diensten te beheren." }, { status: 401 });
  try {
    const services = await listServices(true);
    return Response.json({ services }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Diensten konden niet worden geladen." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  if (!await hasAdminSession(request)) return Response.json({ error: "Je sessie is verlopen. Log opnieuw in." }, { status: 401 });
  try {
    const service = validateService(await request.json());
    await createSettingsBackup("Voor toevoegen van dienst");
    const saved = await saveService(service);
    await logAdminAction("Dienst toegevoegd", saved.name);
    return Response.json({ service: saved }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "De dienst kon niet worden opgeslagen." }, { status: 400 });
  }
}
