import { GET as runStatusCheck } from "../status/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const secret = process.env.MONITOR_SECRET;
  if (!secret) return Response.json({ error: "Achtergrondcontrole is niet geconfigureerd." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Niet geautoriseerd." }, { status: 401 });
  }

  const url = new URL("/api/status?range=1h", request.url);
  const response = await runStatusCheck(new Request(url, { method: "GET", headers: { "Cache-Control": "no-store" } }));
  const result = await response.json() as { checkedAt?: number; services?: unknown[]; error?: string };
  return Response.json(
    { ok: response.ok, checkedAt: result.checkedAt ?? Date.now(), checkedServices: result.services?.length ?? 0, ...(response.ok ? {} : { error: result.error }) },
    { status: response.status, headers: { "Cache-Control": "no-store" } },
  );
}
