import { headers } from "next/headers";
import { getSiteSettings, hasAdminSession } from "@/app/lib/server";
import StatusDashboard from "@/components/status-dashboard";
import { SiteMaintenance } from "@/components/site-maintenance";
import { markDatabaseUnavailable } from "@/app/lib/database-availability";

export const dynamic = "force-dynamic";

export default async function Home() {
  let settings;
  try {
    settings = await getSiteSettings();
  } catch (error) {
    markDatabaseUnavailable(error);
    return <SiteMaintenance unavailable />;
  }
  if (settings.maintenance) {
    const request = new Request("https://status.amsterdamrp.nl/", { headers: await headers() });
    if (!await hasAdminSession(request)) return <SiteMaintenance />;
  }
  return <StatusDashboard />;
}
