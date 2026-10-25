import { GET as runStatusCheck } from "../status/route";
import { recordMonitorHeartbeat } from "@/app/lib/server";
import { runScheduledMaintenance } from "@/app/lib/admin-operations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const secret = process.env.MONITOR_SECRET;
  if (!secret) return Response.json({ error: "Achtergrondcontrole is niet geconfigureerd." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Niet geautoriseerd." }, { status: 401 });
  }

  try { await runScheduledMaintenance(); } catch { console.error("Onderhoudsplanning kon deze ronde niet worden uitgevoerd."); }
  const url = new URL("/api/status?range=1h", request.url);
  const response = await runStatusCheck(new Request(url, { method: "GET", headers: { "Cache-Control": "no-store", Authorization: `Bearer ${secret}` } }));
  const result = await response.json() as { checkedAt?: number; services?: unknown[]; error?: string };
  const heartbeatAt = response.ok ? Date.now() : null;
  if (heartbeatAt !== null) await recordMonitorHeartbeat(heartbeatAt);
  return Response.json(
    { ok: response.ok, checkedAt: result.checkedAt ?? Date.now(), heartbeatAt, checkedServices: result.services?.length ?? 0, ...(response.ok ? {} : { error: result.error }) },
    { status: response.status, headers: { "Cache-Control": "no-store", ...(response.headers.has("Retry-After") ? { "Retry-After": response.headers.get("Retry-After")! } : {}) } },
  );
}
