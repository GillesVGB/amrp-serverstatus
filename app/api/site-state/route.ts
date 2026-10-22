import { getSiteSettings } from "@/app/lib/server";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const { maintenance } = await getSiteSettings();
    return Response.json({ maintenance }, { headers });
  } catch {
    return Response.json({ error: "De website-instellingen zijn tijdelijk niet beschikbaar." }, { status: 503, headers });
  }
}
