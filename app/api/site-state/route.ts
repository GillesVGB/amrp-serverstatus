import { getSiteSettings } from "@/app/lib/server";
import { markDatabaseUnavailable } from "@/app/lib/database-availability";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const { maintenance } = await getSiteSettings();
    return Response.json({ maintenance }, { headers });
  } catch (error) {
    const failure = markDatabaseUnavailable(error);
    return Response.json({ unavailable: true, error: "De statusgegevens zijn tijdelijk niet beschikbaar." }, { status: 503, headers: { ...headers, "Retry-After": String(failure.retryAfterSeconds) } });
  }
}
