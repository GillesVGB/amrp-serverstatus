import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hasAdminSession } from "@/app/lib/server";
import { SiteMaintenance } from "@/components/site-maintenance";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Onderhoudsvoorbeeld | Amsterdam Roleplay",
  robots: { index: false, follow: false },
};

export default async function MaintenancePreviewPage() {
  const request = new Request("https://status.amsterdamrp.nl/admin/maintenance-preview", {
    headers: await headers(),
  });
  if (!await hasAdminSession(request)) redirect("/admin");

  return <SiteMaintenance preview />;
}
