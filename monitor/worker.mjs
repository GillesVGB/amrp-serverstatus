const baseUrl = process.env.STATUS_API_URL?.replace(/\/$/, "");
const secret = process.env.MONITOR_SECRET;
const intervalMs = Math.max(600_000, Number(process.env.STATUS_CHECK_INTERVAL_MS) || 600_000);

if (!baseUrl || !secret) {
  console.error("Configureer STATUS_API_URL en MONITOR_SECRET voordat je de monitor start.");
  process.exit(1);
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; });

console.log(`Amsterdam Roleplay-monitor actief; controle-interval ${intervalMs} ms.`);
while (!stopping) {
  let retryDelayMs = intervalMs;
  try {
    const response = await fetch(`${baseUrl}/api/monitor`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`Statuscontrole mislukt (HTTP ${response.status}).`);
      const retryAfter = Number(response.headers.get("Retry-After"));
      retryDelayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.max(intervalMs, Math.min(retryAfter, 900) * 1000)
        : Math.max(intervalMs, 30_000);
    } else {
      const result = await response.json();
      if (result.skipped) console.log("Controle overgeslagen: er is kort geleden al gemeten of een andere worker is actief.");
      else console.log(`Controle voltooid: ${result.checkedServices} diensten · ${new Date(result.checkedAt).toISOString()}`);
    }
  } catch (error) {
    const description = error instanceof Error && error.name === "AbortError" ? "time-out" : "verbinding niet beschikbaar";
    console.error(`Statuscontrole mislukt: ${description}.`);
    retryDelayMs = Math.max(intervalMs, 30_000);
  }
  // The shared cooldown starts after the request has begun. Wait a full
  // interval after completion so the next round cannot arrive too early.
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
}

console.log("Amsterdam Roleplay-monitor gestopt.");
