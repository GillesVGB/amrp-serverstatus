import { createAdminCookie, hasAdminSession, isSameOrigin, privateCookie, verifyAdminPassword } from "@/app/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json({ authenticated: await hasAdminSession(request) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");
    if (username !== "beheerder" || password.length < 12 || password.length > 256 || !await verifyAdminPassword(password)) {
      return Response.json({ error: "Gebruikersnaam of wachtwoord klopt niet." }, { status: 401 });
    }
    const cookie = await createAdminCookie();
    const secure = new URL(request.url).protocol === "https:";
    return Response.json({ authenticated: true }, { headers: { "Set-Cookie": privateCookie(cookie, 8 * 60 * 60, secure), "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Inloggen is tijdelijk niet beschikbaar." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Ongeldige herkomst van het verzoek." }, { status: 403 });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json({ authenticated: false }, { headers: { "Set-Cookie": `amrp_status_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, "Cache-Control": "no-store" } });
}
