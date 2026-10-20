"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CirclePlus, LoaderCircle, LogOut, Pencil, Power, Save, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type Service = { id: string; name: string; category: string; kind: "fivem" | "website" | "http"; endpoint: string; enabled: boolean | number; paused: boolean | number; maintenance: boolean | number; maintenanceMessage: string };
type Draft = { name: string; category: string; kind: Service["kind"]; endpoint: string; enabled: boolean; paused: boolean; maintenance: boolean; maintenanceMessage: string };
const emptyDraft: Draft = { name: "", category: "Websites", kind: "website", endpoint: "https://", enabled: true, paused: false, maintenance: false, maintenanceMessage: "" };

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [username, setUsername] = useState("beheerder");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pauseTarget, setPauseTarget] = useState<Service | null>(null);

  const loadServices = useCallback(async () => {
    const response = await fetch("/api/services", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); return; }
    const payload = await response.json() as { services?: Service[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Diensten konden niet worden geladen.");
    setServices(payload.services ?? []);
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    void fetch("/api/admin/session", { cache: "no-store" }).then(async (response) => await response.json() as { authenticated: boolean }).then(async (result) => {
      if (!result.authenticated) { setAuthenticated(false); return; }
      await loadServices();
    }).catch(() => { setAuthenticated(false); setError("Verbinding met het beheerpaneel mislukt."); });
  }, [loadServices]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Inloggen mislukt.");
      setPassword(""); await loadServices();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inloggen mislukt."); }
    finally { setBusy(false); }
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch(editing ? `/api/services/${encodeURIComponent(editing)}` : "/api/services", {
        method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Opslaan mislukt.");
      await loadServices(); setDraft(emptyDraft); setEditing(null); setNotice(editing ? "Dienst bijgewerkt." : "Dienst toegevoegd.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Opslaan mislukt."); }
    finally { setBusy(false); }
  }

  function beginEdit(service: Service) {
    setEditing(service.id);
    setDraft({ name: service.name, category: service.category, kind: service.kind, endpoint: service.endpoint, enabled: Boolean(service.enabled), paused: Boolean(service.paused), maintenance: Boolean(service.maintenance), maintenanceMessage: service.maintenanceMessage || "" });
    setError(""); setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleService(service: Service, visibleWhilePaused = true) {
    const paused = !Boolean(service.paused);
    const enabled = paused ? visibleWhilePaused : true;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/services/${encodeURIComponent(service.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...service, enabled, paused }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Wijzigen mislukt.");
      await loadServices(); setNotice(paused ? (enabled ? "Dienst gepauzeerd en rood zichtbaar." : "Dienst gepauzeerd en verborgen.") : "Dienst hervat.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wijzigen mislukt."); }
    finally { setBusy(false); }
  }

  async function applyPauseChoice(visible: boolean) {
    if (!pauseTarget) return;
    const target = pauseTarget;
    setPauseTarget(null);
    await toggleService(target, visible);
  }

  async function toggleMaintenance(service: Service) {
    const enable = !service.maintenance;
    const maintenanceMessage = enable
      ? window.prompt("Welke onderhoudsmelding moeten bezoekers zien?", service.maintenanceMessage || "Gepland onderhoud.")
      : service.maintenanceMessage;
    if (maintenanceMessage === null) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/services/${encodeURIComponent(service.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...service, maintenance: enable, maintenanceMessage }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Onderhoudsstatus wijzigen mislukt.");
      await loadServices(); setNotice(enable ? "Dienst staat nu op onderhoud." : "Onderhoudsmelding uitgeschakeld.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Onderhoudsstatus wijzigen mislukt."); }
    finally { setBusy(false); }
  }

  async function removeService(service: Service) {
    if (!window.confirm(`Weet je zeker dat je ${service.name} en de meetgeschiedenis wilt verwijderen?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/services/${encodeURIComponent(service.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Verwijderen mislukt.");
      await loadServices(); setNotice("Dienst verwijderd.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Verwijderen mislukt."); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false); setServices([]); setNotice("");
  }

  if (authenticated === null) return <main className="admin-page"><div className="admin-loading"><LoaderCircle className="spin" /> Beheerpaneel laden…</div></main>;

  if (!authenticated) return (
    <main className="admin-page admin-login-wrap">
      <Link className="back-link" href="/"><ArrowLeft size={16} /> Terug naar status</Link>
      <section className="login-card">
        <div className="login-icon"><ShieldCheck size={26} /></div>
        <p className="eyebrow">AMSTERDAM ROLEPLAY</p><h1>Beheerpaneel</h1>
        <p className="admin-muted">Log in om diensten en controles te beheren.</p>
        <form className="admin-form login-form" onSubmit={login}>
          <label>Gebruikersnaam<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>Wachtwoord<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Inloggen</button>
        </form>
      </section>
    </main>
  );

  return (
    <main className="admin-page">
      <header className="admin-topbar"><Link className="back-link" href="/"><ArrowLeft size={16} /> Statuspagina</Link><div className="admin-topbar-actions"><ThemeToggle /><button className="subtle-button" onClick={logout}><LogOut size={15} /> Uitloggen</button></div></header>
      <div className="admin-content">
        <p className="eyebrow">AMSTERDAM ROLEPLAY</p><h1>Diensten beheren</h1>
        <p className="admin-muted">Voeg websites, FiveM-servers en andere diensten toe. Wijzigingen zijn direct zichtbaar op de statuspagina.</p>
        {error && <p className="form-error notice" role="alert">{error}</p>}
        {notice && <p className="form-success notice" role="status"><Check size={16} /> {notice}</p>}

        <section className="admin-panel">
          <div className="panel-heading"><span className="panel-icon"><CirclePlus size={18} /></span><div><h2>{editing ? "Dienst aanpassen" : "Dienst toevoegen"}</h2><p>Vul de basisgegevens in. De controle wordt elke 5 seconden herhaald.</p></div></div>
          <form className="admin-form service-form" onSubmit={saveService}>
            <label>Naam<input maxLength={70} placeholder="Bijvoorbeeld: Main Game Server" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
            <label>Categorie<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}><option>FiveM servers</option><option>Websites</option><option>Diensten</option><option>Discord</option></select></label>
            <label>Controlemethode<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Draft["kind"] })}><option value="website">Website (HTTP/HTTPS)</option><option value="fivem">FiveM dynamic.json</option><option value="http">HTTP-dienst</option></select></label>
            <label className="wide-field">Adres<input maxLength={500} type="url" placeholder="https://voorbeeld.nl/health" value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} required /><span className="field-hint">Voor FiveM: gebruik het volledige dynamic.json-adres. Een gewone poortcontrole voor een bot kan niet bewijzen of het botproces zelf actief is.</span></label>
            <label className="wide-field maintenance-option"><span><input type="checkbox" checked={draft.maintenance} onChange={(event) => setDraft({ ...draft, maintenance: event.target.checked })} /> Deze dienst staat in onderhoud (oranje)</span><input maxLength={220} placeholder="Melding voor bezoekers, bijvoorbeeld: We voeren gepland onderhoud uit." value={draft.maintenanceMessage} onChange={(event) => setDraft({ ...draft, maintenanceMessage: event.target.value })} disabled={!draft.maintenance} /></label>
            <div className="form-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{editing ? "Wijzigingen opslaan" : "Dienst toevoegen"}</button>{editing && <button type="button" className="subtle-button" onClick={() => { setEditing(null); setDraft(emptyDraft); }}><X size={16} /> Annuleren</button>}</div>
          </form>
        </section>

        <section className="admin-panel services-panel">
          <div className="panel-heading"><span className="panel-icon"><ShieldCheck size={18} /></span><div><h2>Ingestelde diensten <span className="small-count">{services.length}</span></h2><p>Pauzeer een dienst en kies of bezoekers hem rood blijven zien of dat hij wordt verborgen.</p></div></div>
          <div className="managed-services">
            {services.map((service) => (
              <article className="managed-service" key={service.id}>
                <span className={`managed-status ${service.paused ? service.enabled ? "paused-visible" : "paused" : service.maintenance ? "maintenance" : "enabled"}`} />
                <div className="managed-info"><strong>{service.name}</strong><span>{service.category} · {service.kind === "fivem" ? "FiveM" : service.kind === "website" ? "Website" : "HTTP"} · {service.paused ? service.enabled ? "Gepauzeerd · zichtbaar (rood)" : "Gepauzeerd · verborgen" : service.maintenance ? "Onderhoud" : "Actief"}</span><span className="managed-private-address">Adres wordt alleen gebruikt voor de controle.</span></div>
                <div className="managed-actions"><button className={`icon-button ${service.maintenance ? "maintenance-action" : ""}`} title={service.maintenance ? "Onderhoud beëindigen" : "Op onderhoud zetten"} aria-label={service.maintenance ? `${service.name} uit onderhoud halen` : `${service.name} op onderhoud zetten`} onClick={() => void toggleMaintenance(service)} disabled={busy}><Wrench size={16} /></button><button className={`icon-button ${service.paused && service.enabled ? "pause-visible-action" : ""}`} title={service.paused ? "Dienst hervatten" : "Pauzeren"} aria-label={service.paused ? `${service.name} hervatten` : `${service.name} pauzeren`} onClick={() => service.paused ? void toggleService(service) : setPauseTarget(service)} disabled={busy}><Power size={16} /></button><button className="icon-button" title="Aanpassen" aria-label={`${service.name} aanpassen`} onClick={() => beginEdit(service)} disabled={busy}><Pencil size={16} /></button><button className="icon-button danger-icon" title="Verwijderen" aria-label={`${service.name} verwijderen`} onClick={() => void removeService(service)} disabled={busy}><Trash2 size={16} /></button></div>
              </article>
            ))}
            {services.length === 0 && <div className="empty-group">Geen diensten gevonden.</div>}
          </div>
        </section>
        {pauseTarget && (
          <div className="pause-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPauseTarget(null); }}>
            <section className="pause-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-dialog-title">
              <button type="button" className="pause-dialog-close" aria-label="Sluiten" onClick={() => setPauseTarget(null)}><X size={17} /></button>
              <span className="panel-icon"><Power size={18} /></span>
              <h2 id="pause-dialog-title">{pauseTarget.name} pauzeren</h2>
              <p>Kies hoe bezoekers deze dienst zien zolang hij gepauzeerd is.</p>
              <div className="pause-dialog-actions">
                <button type="button" className="pause-hide-button" onClick={() => void applyPauseChoice(false)} disabled={busy}><X size={16} /> Pauzeren en verbergen</button>
                <button type="button" className="pause-red-button" onClick={() => void applyPauseChoice(true)} disabled={busy}><Power size={16} /> Zichtbaar houden als storing</button>
              </div>
            </section>
          </div>
        )}
        <p className="admin-footnote">De controle loopt zodra iemand de statuspagina bezoekt en zolang die openstaat. FiveM wordt gecontroleerd via dynamic.json. Een bot zonder HTTP-statusroute kan alleen als netwerkadres worden getest.</p>
      </div>
    </main>
  );
}
