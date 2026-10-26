import { getSiteSettingsReadOnly } from "@/app/lib/server";
import { markDatabaseUnavailable } from "@/app/lib/database-availability";

export const dynamic = "force-dynamic";

const publicCache = {
  "Cache-Control": "public, max-age=5",
  "Vercel-CDN-Cache-Control": "public, s-maxage=15",
};
const privateNoStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const { maintenance, reason } = await getSiteSettingsReadOnly();
    return Response.json({ maintenance, reason: maintenance ? reason : "" }, { headers: publicCache });
  } catch (error) {
    const failure = markDatabaseUnavailable(error);
    return Response.json({ unavailable: true, error: "De statusgegevens zijn tijdelijk niet beschikbaar." }, { status: 503, headers: { ...privateNoStore, "Retry-After": String(failure.retryAfterSeconds) } });
  }
}
