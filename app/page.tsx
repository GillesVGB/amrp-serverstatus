import StatusDashboard from "@/components/status-dashboard";

// Keep the shell at the CDN. Live and personalized state is loaded by the
// client from the separately controlled status API.
export const dynamic = "force-static";

export default function Home() {
  return <StatusDashboard />;
}
