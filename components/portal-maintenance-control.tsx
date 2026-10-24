"use client";

import { useCallback, useEffect, useState } from "react";
import { Wrench } from "lucide-react";

type Maintenance = { enabled: boolean; reason: string; updatedAt: string | null };
type PortalResponse = { maintenance?: Maintenance; error?: string; warning?: string };

export function PortalMaintenanceControl({ onChanged }: { onChanged: () => Promise<void> }) {
  const [state, setState] = useState<Maintenance | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/portal-maintenance", { cache: "no-store" });
      const data = await response.json() as PortalResponse;
      if (!response.ok || !data.maintenance) throw new Error(data.error || "Ophalen mislukt.");
      setError(""); setState(data.maintenance); setReason(data.maintenance.reason || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ophalen mislukt."); setState(null); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function update(enabled: boolean) {
    if (enabled && !window.confirm("Het overheidsportaal echt sluiten voor gewone gebruikers? Zij zien de onderhoudspagina. Overheidsbeheerders houden toegang.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/portal-maintenance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, reason }) });
      const data = await response.json() as PortalResponse;
      if (!response.ok || !data.maintenance) throw new Error(data.error || "Wijzigen mislukt.");
      setState(data.maintenance); setReason(data.maintenance.reason || "");
      setNotice(data.warning || (enabled ? "Het overheidsportaal is gesloten voor gewone gebruikers." : "Het overheidsportaal is weer geopend. Algemene storingsmeldingen blijven afzonderlijk actief."));
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wijzigen mislukt."); setState(null); }
    finally { setBusy(false); }
  }

  return <details className="admin-panel site-access-panel admin-collapsible" aria-labelledby="portal-access-title">
    <summary className="admin-collapse-heading"><div className="panel-heading"><span className="panel-icon"><Wrench size={18} /></span><div><h2 id="portal-access-title">Overheidsportaal bedienen</h2><p>Sluit overheid.amsterdamrp.nl voor gewone gebruikers of open de website weer. Overheidsbeheerders behouden toegang. MEOS is nog niet gekoppeld.</p></div></div></summary><div className="admin-collapse-content">
    <p role="status"><strong>{busy ? "Verbinding maken…" : state ? state.enabled ? "Overheidsportaal in onderhoud" : "Overheidsportaal geopend" : "Onderhoudsstatus onbekend"}</strong></p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    <form onSubmit={(event) => { event.preventDefault(); void update(true); }}>
      <label className="maintenance-reason-field"><span>Onderhoudsreden</span><small>Deze tekst wordt getoond op het overheidsportaal.</small><textarea className="portal-maintenance-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} rows={3} required disabled={busy || !state} placeholder="Waarom is het overheidsportaal tijdelijk gesloten?" /></label>
      <div className="site-access-actions">
        <button type="submit" className="subtle-button" disabled={busy || !state}>{state?.enabled ? "Onderhoudsreden bijwerken" : "Overheidsportaal in onderhoud plaatsen"}</button>
        {state?.enabled && <button type="button" className="primary-button" disabled={busy} onClick={() => void update(false)}>Overheidsportaal weer openen</button>}
        <button type="button" className="subtle-button" disabled={busy} onClick={() => { setBusy(true); void load(); }}>Status verversen</button>
      </div>
    </form>
  </div></details>;
}
