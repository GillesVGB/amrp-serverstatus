"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CirclePlus, LoaderCircle, LogOut, Megaphone, Pencil, Power, Save, Send, ShieldCheck, Trash2, Wrench, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type Service = { id: string; name: string; category: string; kind: "fivem" | "website" | "http"; endpoint: string; enabled: boolean | number; paused: boolean | number; maintenance: boolean | number; maintenanceMessage: string };
type Draft = { name: string; category: string; kind: Service["kind"]; endpoint: string; enabled: boolean; paused: boolean; maintenance: boolean; maintenanceMessage: string };
const emptyDraft: Draft = { name: "", category: "Websites", kind: "website", endpoint: "https://", enabled: true, paused: false, maintenance: false, maintenanceMessage: "" };
type AnnouncementService = { id: string; name: string };
type Announcement = { id: string; title: string; description: string; kind: "outage" | "notice"; affectedServices: AnnouncementService[]; published: boolean; publishedAt: number | null; createdAt: number; updatedAt: number };
type AnnouncementDraft = { title: string; description: string; kind: Announcement["kind"]; serviceIds: string[]; published: boolean };
const emptyAnnouncementDraft: AnnouncementDraft = { title: "", description: "", kind: "notice", serviceIds: [], published: false };

function formatAnnouncementDate(value: number) {
  return new Date(value).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementDraft, setAnnouncementDraft] = useState<AnnouncementDraft>(emptyAnnouncementDraft);
  const [editingAnnouncement, setEditingAnnouncement] = useState<string | null>(null);
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

  const loadAnnouncements = useCallback(async () => {
    const response = await fetch("/api/admin/announcements", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); return; }
    const payload = await response.json() as { announcements?: Announcement[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Meldingen konden niet worden geladen.");
    setAnnouncements(payload.announcements ?? []);
  }, []);

  const loadAdminData = useCallback(async () => {
    await Promise.all([loadServices(), loadAnnouncements()]);
  }, [loadAnnouncements, loadServices]);

  useEffect(() => {
    void fetch("/api/admin/session", { cache: "no-store" }).then(async (response) => await response.json() as { authenticated: boolean }).then(async (result) => {
      if (!result.authenticated) { setAuthenticated(false); return; }
      await loadAdminData();
    }).catch(() => { setAuthenticated(false); setError("Verbinding met het beheerpaneel mislukt."); });
  }, [loadAdminData]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Inloggen mislukt.");
      setPassword(""); await loadAdminData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inloggen mislukt."); }
    finally { setBusy(false); }
  }

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch(editingAnnouncement ? `/api/admin/announcements/${encodeURIComponent(editingAnnouncement)}` : "/api/admin/announcements", {
        method: editingAnnouncement ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(announcementDraft),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "De melding kon niet worden opgeslagen.");
      await loadAnnouncements();
      setAnnouncementDraft(emptyAnnouncementDraft);
      setEditingAnnouncement(null);
      setNotice(editingAnnouncement ? "Melding bijgewerkt." : announcementDraft.published ? "Melding gepubliceerd." : "Conceptmelding opgeslagen.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "De melding kon niet worden opgeslagen."); }
    finally { setBusy(false); }
  }

  function beginEditAnnouncement(announcement: Announcement) {
    setEditingAnnouncement(announcement.id);
    setAnnouncementDraft({ title: announcement.title, description: announcement.description, kind: announcement.kind, serviceIds: announcement.affectedServices.map((service) => service.id), published: announcement.published });
    setError(""); setNotice("");
    document.getElementById("announcement-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function toggleAnnouncement(announcement: Announcement) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: announcement.title, description: announcement.description, kind: announcement.kind, serviceIds: announcement.affectedServices.map((service) => service.id), published: !announcement.published }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Publicatiestatus wijzigen mislukt.");
      await loadAnnouncements();
      setNotice(announcement.published ? "Melding ingetrokken." : "Melding gepubliceerd.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Publicatiestatus wijzigen mislukt."); }
    finally { setBusy(false); }
  }

  async function removeAnnouncement(announcement: Announcement) {
    if (!window.confirm(`Weet je zeker dat je de melding “${announcement.title}” wilt verwijderen?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "De melding kon niet worden verwijderd.");
      await loadAnnouncements();
      if (editingAnnouncement === announcement.id) { setEditingAnnouncement(null); setAnnouncementDraft(emptyAnnouncementDraft); }
      setNotice("Melding verwijderd.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "De melding kon niet worden verwijderd."); }
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
    setAuthenticated(false); setServices([]); setAnnouncements([]); setNotice("");
  }

  if (authenticated === null) return <main className="admin-page"><div className="admin-loading"><LoaderCircle className="spin" /> Beheerpaneel laden…</div></main>;

  if (!authenticated) return (
    <main className="admin-page admin-login-wrap">
      <Link className="back-link" href="/"><ArrowLeft size={16} /> Terug naar status</Link>
      <section className="login-card">
        <div className="login-icon"><ShieldCheck size={26} /></div>
        <p className="eyebrow">AMSTERDAM ROLEPLAY</p><h1>Beheerpaneel</h1>
        <p className="admin-muted">Log in om diensten, controles en mededelingen te beheren.</p>
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
        <p className="eyebrow">AMSTERDAM ROLEPLAY</p><h1>Beheerpaneel</h1>
        <p className="admin-muted">Beheer diensten en publiceer algemene storingen of mededelingen op de statuspagina.</p>
        {error && <p className="form-error notice" role="alert">{error}</p>}
        {notice && <p className="form-success notice" role="status"><Check size={16} /> {notice}</p>}

        <section className="admin-panel announcements-panel" aria-labelledby="announcements-admin-title">
          <div className="panel-heading"><span className="panel-icon"><Megaphone size={18} /></span><div><h2 id="announcements-admin-title">Algemene storing of mededeling <span className="small-count">{announcements.length}</span></h2><p>Publiceer een los bericht boven de actieve incidenten. Concepten zijn alleen zichtbaar in dit beheerpanel.</p></div></div>
          <form id="announcement-form" className="admin-form announcement-form" onSubmit={saveAnnouncement}>
            <label>Type melding<select value={announcementDraft.kind} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, kind: event.target.value as AnnouncementDraft["kind"] })}><option value="notice">Mededeling</option><option value="outage">Algemene storing</option></select></label>
            <label className="wide-field">Titel<input maxLength={120} placeholder="Bijvoorbeeld: Problemen met het overheidsportaal" value={announcementDraft.title} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, title: event.target.value })} required /></label>
            <label className="wide-field">Uitgebreide beschrijving<textarea maxLength={5000} rows={5} placeholder="Leg uit wat er aan de hand is, wie er last van heeft en wat bezoekers kunnen verwachten." value={announcementDraft.description} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, description: event.target.value })} required /></label>
            <fieldset className="announcement-service-fieldset wide-field">
              <legend>Getroffen diensten <span className="field-hint">Meerdere keuzes mogelijk. Laat leeg voor een algemene mededeling.</span></legend>
              <div className="announcement-service-options">
                {services.map((service) => <label key={service.id}><input type="checkbox" checked={announcementDraft.serviceIds.includes(service.id)} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, serviceIds: event.target.checked ? [...current.serviceIds, service.id] : current.serviceIds.filter((id) => id !== service.id) }))} /><span>{service.name}<small>{service.category}</small></span></label>)}
                {services.length === 0 && <span className="field-hint">Voeg eerst diensten toe om ze hier te kunnen selecteren.</span>}
              </div>
            </fieldset>
            <label className="announcement-publish-option wide-field"><input type="checkbox" checked={announcementDraft.published} onChange={(event) => setAnnouncementDraft({ ...announcementDraft, published: event.target.checked })} /><span><strong>Meteen publiceren</strong><small>De melding wordt direct zichtbaar op de statuspagina.</small></span></label>
            <div className="form-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : announcementDraft.published ? <Send size={16} /> : <Save size={17} />}{editingAnnouncement ? "Wijzigingen opslaan" : announcementDraft.published ? "Melding publiceren" : "Concept opslaan"}</button>{editingAnnouncement && <button type="button" className="subtle-button" onClick={() => { setEditingAnnouncement(null); setAnnouncementDraft(emptyAnnouncementDraft); }}><X size={16} /> Annuleren</button>}</div>
          </form>
          <div className="announcement-admin-list" aria-label="Aangemaakte meldingen">
            {announcements.map((announcement) => <article className="announcement-admin-card" key={announcement.id}>
              <div className="announcement-admin-main"><div className="announcement-admin-title"><strong>{announcement.title}</strong><span className={`announcement-kind is-${announcement.kind}`}>{announcement.kind === "outage" ? "Storing" : "Mededeling"}</span><span className={`announcement-status ${announcement.published ? "is-published" : "is-draft"}`}>{announcement.published ? "Gepubliceerd" : "Concept"}</span></div><p>{announcement.description}</p><div className="announcement-admin-meta"><span>{announcement.publishedAt ? `Gepubliceerd ${formatAnnouncementDate(announcement.publishedAt)}` : `Aangemaakt ${formatAnnouncementDate(announcement.createdAt)}`}</span><span>{announcement.affectedServices.length ? announcement.affectedServices.map((service) => service.name).join(", ") : "Algemene mededeling"}</span></div></div>
              <div className="managed-actions"><button className="icon-button" title="Aanpassen" aria-label={`${announcement.title} aanpassen`} onClick={() => beginEditAnnouncement(announcement)} disabled={busy}><Pencil size={16} /></button><button className={`announcement-publish-button ${announcement.published ? "is-published" : ""}`} onClick={() => void toggleAnnouncement(announcement)} disabled={busy}>{announcement.published ? "Intrekken" : "Publiceren"}</button><button className="icon-button danger-icon" title="Verwijderen" aria-label={`${announcement.title} verwijderen`} onClick={() => void removeAnnouncement(announcement)} disabled={busy}><Trash2 size={16} /></button></div>
            </article>)}
            {announcements.length === 0 && <div className="announcement-admin-empty"><Megaphone size={17} /><span>Nog geen algemene meldingen. Maak hierboven je eerste bericht aan.</span></div>}
          </div>
        </section>

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
