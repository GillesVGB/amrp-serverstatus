"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Activity, ArrowUpRight, Bell, BellOff, Bot, ChartNoAxesColumn, Check, ChevronDown, CircleCheck, Clock3, Gamepad2, Globe, HeartPulse, Layers3, LayoutGrid, List, Megaphone, MessagesSquare, Radio, RefreshCw, Search, Server, Settings, ShieldAlert, ShieldCheck, TriangleAlert, WifiOff, Wrench } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { CreatorCredit } from "@/components/creator-credit";
import { SiteMaintenance } from "@/components/site-maintenance";

type Status = "operational" | "degraded" | "down" | "unknown" | "maintenance";
type MonitorStatus = "active" | "stale" | "unknown";
type Range = "1h" | "12h" | "24h";
type UptimeView = "timeline" | "heartbeat" | "summary";
type ServiceView = "cards" | "table";
type Density = "comfortable" | "compact" | "visual";
type ServiceFilter = "all" | "attention" | "operational";
type ServiceColumn = "name" | "category" | "status" | "uptime" | "response" | "players";
type SortColumn = ServiceColumn;
type HistorySample = { status: Status; checkedAt: number; message: string };
type DashboardPreferences = {
  serviceView: ServiceView;
  density: Density;
  showMetrics: boolean;
  showMonitor: boolean;
  showResolvedIncidents: boolean;
  visibleColumns: ServiceColumn[];
  searchQuery: string;
  statusFilter: ServiceFilter;
  range: Range;
  uptimeView: UptimeView;
};
type Incident = { id: number; serviceId: string; serviceName: string; status: Status; reason: string; startedAt: number; resolvedAt: number | null };
type Announcement = { id: string; title: string; description: string; kind: "outage" | "notice"; affectedServices: { id: string; name: string }[]; publishedAt: number | null };
type Service = {
  id: string;
  name: string;
  category: string;
  kind: string;
  enabled: boolean;
  maintenance: boolean;
  maintenanceMessage?: string;
  status: Status;
  message: string;
  responseMs: number | null;
  checkedAt: number | null;
  players?: number | null;
  maxPlayers?: number | null;
  uptime?: number | null;
  history: (HistorySample | null)[];
};

const statusLabels: Record<Status, string> = {
  operational: "Operationeel",
  degraded: "Gedeeltelijke storing",
  down: "Storing",
  unknown: "Niet gecontroleerd",
  maintenance: "Onderhoud",
};

function CategorySymbol({ category }: { category: string }) {
  const normalized = category.toLocaleLowerCase();
  if (normalized.includes("fivem")) return <Gamepad2 size={16} aria-hidden="true" />;
  if (normalized.includes("discord")) return <MessagesSquare size={16} aria-hidden="true" />;
  if (normalized.includes("website")) return <Globe size={16} aria-hidden="true" />;
  return <Server size={16} aria-hidden="true" />;
}

function ServiceVisual({ service }: { service: Service }) {
  const category = service.category.toLocaleLowerCase();
  const Icon = service.kind === "fivem" ? Gamepad2 : category.includes("discord") ? Bot : category.includes("website") ? Globe : Server;
  return <span className="service-visual"><Icon size={21} aria-hidden="true" /></span>;
}

const rangeLabels: Record<Range, string> = { "1h": "1 uur", "12h": "12 uur", "24h": "24 uur" };
const preferenceKey = "amrp-status-dashboard-v1";
const uptimePreferenceVersionKey = "amrp-status-uptime-preference-v2";
const defaultPreferences: DashboardPreferences = {
  serviceView: "cards",
  density: "comfortable",
  showMetrics: true,
  showMonitor: true,
  showResolvedIncidents: true,
  visibleColumns: ["name", "category", "status", "uptime", "response", "players"],
  searchQuery: "",
  statusFilter: "all",
  range: "1h",
  uptimeView: "timeline",
};
const serviceColumnLabels: Record<ServiceColumn, string> = {
  name: "Dienst",
  category: "Groep",
  status: "Status",
  uptime: "Beschikbaarheid",
  response: "Reactietijd",
  players: "Spelers",
};
const sortStatusOrder: Record<Status, number> = { down: 0, degraded: 1, maintenance: 2, unknown: 3, operational: 4 };

function readPreferences(): DashboardPreferences {
  try {
    const stored = JSON.parse(window.localStorage.getItem(preferenceKey) || "null") as (Partial<Omit<DashboardPreferences, "uptimeView">> & { uptimeView?: string }) | null;
    if (!stored) return defaultPreferences;
    const hasCurrentUptimePreference = window.localStorage.getItem(uptimePreferenceVersionKey) === "2";
    const validColumns = Array.isArray(stored.visibleColumns) ? stored.visibleColumns.filter((column): column is ServiceColumn => ["name", "category", "status", "uptime", "response", "players"].includes(column)) : defaultPreferences.visibleColumns;
    return {
      serviceView: stored.serviceView === "table" ? "table" : "cards",
      density: stored.density === "compact" || stored.density === "visual" ? stored.density : "comfortable",
      showMetrics: typeof stored.showMetrics === "boolean" ? stored.showMetrics : true,
      showMonitor: typeof stored.showMonitor === "boolean" ? stored.showMonitor : true,
      showResolvedIncidents: typeof stored.showResolvedIncidents === "boolean" ? stored.showResolvedIncidents : true,
      visibleColumns: validColumns.includes("name") ? validColumns : ["name", ...validColumns],
      searchQuery: typeof stored.searchQuery === "string" ? stored.searchQuery : "",
      statusFilter: stored.statusFilter === "attention" || stored.statusFilter === "operational" ? stored.statusFilter : "all",
      range: stored.range === "12h" ? "12h" : stored.range === "24h" || String(stored.range) === "7d" ? "24h" : "1h",
      uptimeView: !hasCurrentUptimePreference ? defaultPreferences.uptimeView : stored.uptimeView === "heartbeat" ? "heartbeat" : stored.uptimeView === "summary" ? "summary" : "timeline",
    };
  } catch {
    return defaultPreferences;
  }
}

function UptimeBars({ history, status, range, uptime, view }: { history: Service["history"]; status: Status; range: Range; uptime: Service["uptime"]; view: UptimeView }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex === null ? null : history[selectedIndex] ?? null;
  const knownSamples = history.filter((sample): sample is HistorySample => sample !== null && sample.status !== "unknown" && sample.status !== "maintenance");
  const heartbeatSamples = history.length > 24
    ? Array.from({ length: 24 }, (_, slot) => {
      const index = Math.round(slot * (history.length - 1) / 23);
      return { sample: history[index], index };
    })
    : history.map((sample, index) => ({ sample, index }));
  const operationalSamples = history.filter((sample) => sample?.status === "operational").length;
  const degradedSamples = history.filter((sample) => sample?.status === "degraded").length;
  const downSamples = history.filter((sample) => sample?.status === "down").length;
  const uptimeLabel = uptime === null || uptime === undefined ? "n.v.t." : `${Number.isInteger(uptime) ? uptime : uptime.toFixed(2)}%`;
  return (
    <div className={`uptime uptime-view-${view}`} role="group" aria-label={`Beschikbaarheid van de afgelopen ${rangeLabels[range]}`}>
      {view === "summary" ? <div className="uptime-score">
        <div className="uptime-ring-wrap"><div className="uptime-ring" style={{ background: uptime === null || uptime === undefined ? "var(--uptime-empty)" : `conic-gradient(var(--uptime-good) ${uptime}%, var(--uptime-bad) ${uptime}% 100%)` }}><div className="uptime-ring-inner"><strong>{uptimeLabel}</strong><span>beschikbaar</span></div></div></div>
        <div className="uptime-score-meta"><div className="uptime-score-period"><strong>{rangeLabels[range]}</strong><span>{knownSamples.length} geldige metingen</span></div>
          <div className="uptime-score-stats"><span><i className="is-operational" />Operationeel <b>{operationalSamples}</b></span><span><i className="is-degraded" />Deels verstoord <b>{degradedSamples}</b></span><span><i className="is-down" />Storing <b>{downSamples}</b></span></div>
        </div>
      </div> : view === "heartbeat" ? <div className="heartbeat-track" style={{ gridTemplateColumns: `repeat(${Math.max(1, heartbeatSamples.length)}, minmax(0, 1fr))` }}>
        {heartbeatSamples.map(({ sample, index }) => (
          <button
            key={sample?.checkedAt ?? index}
            type="button"
            className={`heartbeat-beat ${sample ? `is-${sample.status}` : "is-empty"}${selectedIndex === index ? " is-selected" : ""}`}
            title={sample ? `${statusLabels[sample.status]} · ${new Date(sample.checkedAt).toLocaleTimeString("nl-NL")}` : "Nog geen meting"}
            aria-label={sample ? `${statusLabels[sample.status]} om ${new Date(sample.checkedAt).toLocaleTimeString("nl-NL")}. Klik voor details.` : "Nog geen meting voor dit tijdvak. Klik voor details."}
            aria-pressed={selectedIndex === index}
            onClick={() => setSelectedIndex((current) => current === index ? null : index)}
          ><svg viewBox="0 0 28 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 21h5l3-2 3 5 3-19 3 29 3-15 3 2h5" /></svg></button>
        ))}
      </div> : <div className="uptime-bars">
        {history.map((sample, index) => (
          <button
            key={sample?.checkedAt ?? index}
            type="button"
            className={`uptime-bar ${sample ? `is-${sample.status}` : "is-empty"}${selectedIndex === index ? " is-selected" : ""}`}
            title={sample ? `${statusLabels[sample.status]} · ${new Date(sample.checkedAt).toLocaleTimeString("nl-NL")}` : "Nog geen meting"}
            aria-label={sample ? `${statusLabels[sample.status]} om ${new Date(sample.checkedAt).toLocaleTimeString("nl-NL")}. Klik voor details.` : "Nog geen meting voor dit tijdvak. Klik voor details."}
            aria-pressed={selectedIndex === index}
            onClick={() => setSelectedIndex((current) => current === index ? null : index)}
          />
        ))}
      </div>}
      {selectedIndex !== null && (
        <div className={`uptime-detail ${selected ? `is-${selected.status}` : "is-empty"}`} role="status">
          <div className="uptime-detail-heading">
            <strong>{selected ? statusLabels[selected.status] : "Geen meting"}</strong>
            {selected && <time dateTime={new Date(selected.checkedAt).toISOString()}>{new Date(selected.checkedAt).toLocaleString("nl-NL", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</time>}
          </div>
          <span>{selected?.message || "Voor dit tijdvak is nog geen controle opgeslagen."}</span>
        </div>
      )}
      {view === "heartbeat" ? <div className="uptime-labels"><span>Elke puls = één controle</span><span>Oud → nu · {rangeLabels[range]}</span></div> : view === "timeline" && <div className="uptime-labels"><span>Beschikbaar <strong>{uptimeLabel}</strong></span><span>{rangeLabels[range]} · {status === "operational" ? "live" : "laatste meting"}</span></div>}
    </div>
  );
}

function summarize(services: Service[]) {
  if (!services.length) return "unknown";
  if (services.some((service) => service.status === "down")) return "down";
  if (services.some((service) => service.status === "degraded")) return "degraded";
  if (services.some((service) => service.status === "maintenance")) return "maintenance";
  if (services.some((service) => service.status === "unknown")) return "unknown";
  return "operational";
}

function formatIncidentDuration(startedAt: number) {
  const totalMinutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
  if (totalMinutes < 1) return "minder dan 1 minuut";
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} ${days === 1 ? "dag" : "dagen"}${hours ? ` ${hours} uur` : ""}`;
  if (hours > 0) return `${hours} uur${minutes ? ` ${minutes} min` : ""}`;
  return `${totalMinutes} min`;
}

export default function StatusDashboard() {
  const [siteMaintenance, setSiteMaintenance] = useState(false);
  const [siteMaintenanceReason, setSiteMaintenanceReason] = useState("");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [hasInitialResponse, setHasInitialResponse] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [monitorCheckedAt, setMonitorCheckedAt] = useState<number | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus>("unknown");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeIncidentsCollapsed, setActiveIncidentsCollapsed] = useState(true);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [preferences, setPreferences] = useState<DashboardPreferences>(defaultPreferences);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const previousStatuses = useRef<Record<string, Status> | null>(null);
  const checking = useRef(false);
  const { range } = preferences;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreferences(readPreferences());
      setPreferencesLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      window.localStorage.setItem(preferenceKey, JSON.stringify(preferences));
      window.localStorage.setItem(uptimePreferenceVersionKey, "2");
    } catch { /* Keep the controls usable when browser storage is unavailable. */ }
  }, [preferences, preferencesLoaded]);

  function updatePreference<Key extends keyof DashboardPreferences>(key: Key, value: DashboardPreferences[Key]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function toggleVisibleColumn(column: ServiceColumn) {
    if (column === "name") return;
    const columns = preferences.visibleColumns.includes(column)
      ? preferences.visibleColumns.filter((current) => current !== column)
      : [...preferences.visibleColumns, column];
    updatePreference("visibleColumns", columns);
  }

  function changeSort(column: SortColumn) {
    if (sortColumn === column) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function clearServiceFilters() {
    updatePreference("searchQuery", "");
    updatePreference("statusFilter", "all");
  }

  const refresh = useCallback(async (manual = false) => {
    if (checking.current) return;
    checking.current = true;
    if (manual) setRefreshing(true);
    try {
      const response = await fetch(`/api/status?range=${range}`);
      if (response.status === 503) {
        const failure = await response.json() as { maintenance?: boolean; reason?: string; unavailable?: boolean; error?: string };
        if (failure.unavailable) {
          setStatusUnavailable(true);
          setServices([]);
          setIncidents([]);
          setAnnouncements([]);
          previousStatuses.current = null;
          return;
        }
        if (failure.maintenance) {
          setSiteMaintenance(true);
          setSiteMaintenanceReason(failure.reason || "");
          setServices([]);
          setIncidents([]);
          setAnnouncements([]);
          previousStatuses.current = null;
          return;
        }
        throw new Error(failure.error || "De status kon niet worden opgehaald.");
      }
      if (!response.ok) throw new Error("De status kon niet worden opgehaald.");
      const payload = await response.json() as { services: Service[]; incidents: Incident[]; announcements?: Announcement[]; checkedAt: number; monitorCheckedAt?: number | null; monitorStatus?: MonitorStatus };
      const previous = previousStatuses.current;
      if (previous && typeof Notification !== "undefined" && Notification.permission === "granted" && localStorage.getItem("amrp_status_subscribed") === "true") {
        const changes = payload.services.filter((service) => previous[service.id] && previous[service.id] !== service.status && (service.status === "down" || service.status === "degraded" || service.status === "maintenance" || service.status === "operational"));
        if (changes.length) {
          const names = changes.slice(0, 3).map((service) => service.name).join(", ");
          const message = changes.some((service) => service.status === "down" || service.status === "degraded" || service.status === "maintenance") ? `Status gewijzigd: ${names}` : `Hersteld: ${names}`;
          new Notification("Amsterdam Roleplay · statusupdate", { body: message, icon: "/favicon.ico", tag: "amrp-status-change" });
        }
      }
      previousStatuses.current = Object.fromEntries(payload.services.map((service) => [service.id, service.status]));
      setServices(payload.services);
      setSiteMaintenance(false);
      setSiteMaintenanceReason("");
      setStatusUnavailable(false);
      setIncidents(payload.incidents ?? []);
      setAnnouncements(payload.announcements ?? []);
      setLastChecked(payload.checkedAt);
      setMonitorCheckedAt(payload.monitorCheckedAt ?? null);
      setMonitorStatus(payload.monitorStatus ?? "unknown");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "De status kon niet worden opgehaald.");
    } finally {
      setLoading(false);
      setHasInitialResponse(true);
      checking.current = false;
      if (manual) setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    const preference = setTimeout(() => setNotificationsEnabled(localStorage.getItem("amrp_status_subscribed") === "true"), 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay = document.visibilityState === "hidden" ? 1_200_000 : 600_000) => {
      if (timer) clearTimeout(timer);
      if (statusUnavailable) return;
      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, delay);
    };
    const onVisibilityChange = () => {
      if (!statusUnavailable && document.visibilityState === "visible") void refresh();
      schedule();
    };
    const first = statusUnavailable ? undefined : setTimeout(() => { void refresh(); schedule(); }, 0);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(preference);
      if (first) clearTimeout(first);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, statusUnavailable]);

  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      localStorage.removeItem("amrp_status_subscribed");
      setNotificationsEnabled(false);
      setNotificationMessage("Statusmeldingen zijn op dit apparaat uitgezet.");
      return;
    }
    if (!("Notification" in window)) {
      setNotificationMessage("Deze browser ondersteunt geen browsermeldingen.");
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      setNotificationMessage("Sta meldingen toe in je browser om updates te ontvangen.");
      return;
    }
    localStorage.setItem("amrp_status_subscribed", "true");
    setNotificationsEnabled(true);
    setNotificationMessage("Je volgt nu statuswijzigingen op dit apparaat. Laat deze pagina open om meldingen te ontvangen.");
  };

  const activeServices = services.filter((service) => service.enabled);
  const activeIncidents = incidents.filter((incident) => incident.resolvedAt === null);
  const resolvedIncidents = incidents.filter((incident) => incident.resolvedAt !== null);
  const attentionCount = activeServices.filter((service) => service.status !== "operational").length;
  const searchQuery = preferences.searchQuery.trim().toLocaleLowerCase("nl-NL");
  const filteredServices = activeServices.filter((service) => {
    const matchesSearch = !searchQuery || `${service.name} ${service.category} ${service.kind}`.toLocaleLowerCase("nl-NL").includes(searchQuery);
    const matchesFilter = preferences.statusFilter === "all" || (preferences.statusFilter === "operational" ? service.status === "operational" : service.status !== "operational");
    return matchesSearch && matchesFilter;
  });
  const sortedServices = [...filteredServices].sort((left, right) => {
    const valueFor = (service: Service): string | number | null => {
      switch (sortColumn) {
        case "name": return service.name;
        case "category": return service.category;
        case "status": return sortStatusOrder[service.status];
        case "uptime": return service.uptime ?? null;
        case "response": return service.responseMs;
        case "players": return service.players ?? null;
      }
    };
    const leftValue = valueFor(left);
    const rightValue = valueFor(right);
    if (leftValue === null) return rightValue === null ? 0 : 1;
    if (rightValue === null) return -1;
    const comparison = typeof leftValue === "string" && typeof rightValue === "string" ? leftValue.localeCompare(rightValue, "nl") : Number(leftValue) - Number(rightValue);
    return comparison * (sortDirection === "asc" ? 1 : -1);
  });
  const categoryOrder = ["FiveM servers", "Websites", "Diensten"];
  const groups = [...new Set(filteredServices.map((service) => service.category))].sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, "nl");
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
  const overall = summarize(activeServices);
  const onlineCount = activeServices.filter((service) => service.status === "operational").length;
  const updatedAtLabel = lastChecked ? new Date(lastChecked).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" }) : "—";
  const monitorCheckedLabel = monitorCheckedAt ? new Date(monitorCheckedAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "nog geen succesvolle controle";

  if (!hasInitialResponse) return <main className="status-startup" role="status" aria-live="polite" aria-busy="true"><div className="status-startup-card"><span className="status-startup-dot" aria-hidden="true" /><span className="status-startup-copy"><strong>Status wordt opgehaald</strong><span>Een ogenblik, we controleren de actuele status.</span></span></div></main>;
  if (statusUnavailable) return <SiteMaintenance unavailable />;
  if (siteMaintenance) return <SiteMaintenance reason={siteMaintenanceReason} />;

  return (
    <main className="page-shell" data-density={preferences.density}>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Amsterdam Roleplay status">
          <Image src="/amsterdam-logo.png" alt="" width={44} height={44} className="brand-mark" priority />
          <span className="brand-copy"><span className="brand-title">Amsterdam RP</span><span className="brand-subtitle">Systeemstatus</span></span>
        </Link>
        <div className="topbar-right">
          <span className="live-indicator"><span className="live-dot" /><span className="live-label">Laatst bijgewerkt:</span><time dateTime={lastChecked ? new Date(lastChecked).toISOString() : undefined}>{updatedAtLabel}</time></span>
          <details className="preferences-menu">
            <summary aria-label="Persoonlijke weergave-instellingen"><Settings size={17} /><span>Weergave</span></summary>
            <div className="preferences-panel">
              <div className="preferences-panel-heading"><strong>Persoonlijke weergave</strong><span>Wordt op dit apparaat bewaard.</span></div>
              <label className="preference-select"><span>Informatiedichtheid</span><select value={preferences.density} onChange={(event) => updatePreference("density", event.target.value as Density)}><option value="comfortable">Comfortabel</option><option value="compact">Compact</option><option value="visual">Visueel</option></select></label>
              <fieldset className="preference-fieldset"><legend>Overzichtsonderdelen</legend>
                <label className="preference-check"><input type="checkbox" checked={preferences.showMetrics} onChange={(event) => updatePreference("showMetrics", event.target.checked)} />Aantallen bij filters</label>
                <label className="preference-check"><input type="checkbox" checked={preferences.showMonitor} onChange={(event) => updatePreference("showMonitor", event.target.checked)} />Monitorhartslag</label>
                <label className="preference-check"><input type="checkbox" checked={preferences.showResolvedIncidents} onChange={(event) => updatePreference("showResolvedIncidents", event.target.checked)} />Incidentenoverzicht</label>
              </fieldset>
              <fieldset className="preference-fieldset"><legend>Zichtbare tabelkolommen</legend>
                {(Object.keys(serviceColumnLabels) as ServiceColumn[]).map((column) => <label className="preference-check" key={column}><input type="checkbox" checked={preferences.visibleColumns.includes(column)} disabled={column === "name"} onChange={() => toggleVisibleColumn(column)} />{serviceColumnLabels[column]}{column === "name" && <small>verplicht</small>}</label>)}
              </fieldset>
              <div className="preferences-actions">
                <button className={`notification-button${notificationsEnabled ? " is-enabled" : ""}`} type="button" onClick={() => void toggleNotifications()}>{notificationsEnabled ? <BellOff size={15} /> : <Bell size={15} />}{notificationsEnabled ? "Meldingen uitzetten" : "Volg statusmeldingen"}</button>
                <a className="discord-link" href="https://amsterdamrp.nl/" target="_blank" rel="noreferrer">Amsterdam Roleplay <ArrowUpRight size={15} /></a>
              </div>
              <p className="preferences-note">Je weergave en filters worden op dit apparaat bewaard.</p>
            </div>
          </details>
          <ThemeToggle />
          <button className="refresh-button" onClick={() => void refresh(true)} disabled={refreshing} aria-label="Status vernieuwen">
            <RefreshCw size={17} className={refreshing ? "spin" : ""} /> <span>Vernieuwen</span>
          </button>
        </div>
      </header>

      <div className="status-intro">
        <div className="status-intro-main"><h1>Systeemstatus</h1><p className="intro-text">Live inzicht in onze FiveM-servers, websites en diensten.</p></div>
      </div>
      {notificationMessage && <p className="notification-message" role="status">{notificationMessage}</p>}

      <section className={`overall-banner state-${overall}`} aria-live="polite">
        <span className="overall-icon" aria-hidden="true">{overall === "operational" ? <CircleCheck size={26} /> : overall === "unknown" ? <Activity size={26} /> : overall === "maintenance" ? <Clock3 size={26} /> : <TriangleAlert size={26} />}</span>
        <div className="overall-copy">
          <strong>{loading ? "Status wordt gecontroleerd…" : activeServices.length === 0 ? "Nog geen diensten ingesteld" : overall === "operational" ? "Alle systemen operationeel" : overall === "unknown" ? "Niet alle systemen kunnen worden gecontroleerd" : overall === "maintenance" ? "Een of meer diensten zijn in onderhoud" : overall === "degraded" ? "Enkele systemen reageren niet volledig" : "Er is een storing"}</strong>
          <span>{loading ? "De eerste meting duurt enkele seconden." : activeServices.length === 0 ? "Het statusoverzicht wordt gevuld zodra diensten zijn toegevoegd." : `${onlineCount} van ${activeServices.length} diensten operationeel`}</span>
        </div>
        {preferences.showMonitor && <div className="overall-meta"><div className={`monitor-pulse is-${monitorStatus}`} role="status"><Activity size={14} aria-hidden="true" /><span><strong>{monitorStatus === "active" ? "Monitor actief" : monitorStatus === "stale" ? "Monitor mogelijk uitgevallen" : "Monitor nog niet gezien"}</strong><small>Laatste hartslag {monitorCheckedLabel}</small></span></div></div>}
      </section>

      {error && <div className="error-banner" role="alert"><WifiOff size={17} /> {error}</div>}

      {announcements.length > 0 && <section className="public-announcements" aria-labelledby="public-announcements-title">
        <header className="public-announcements-heading"><span className="public-announcements-icon"><Megaphone size={17} aria-hidden="true" /></span><h2 id="public-announcements-title">Algemene storingen en mededelingen <span>{announcements.length}</span></h2></header>
        <div className="public-announcement-list">{announcements.map((announcement) => <article className={`public-announcement-card is-${announcement.kind}`} key={announcement.id}>
          <div className="public-announcement-copy"><div className="public-announcement-title"><div className="public-announcement-title-main"><span className={`public-announcement-kind is-${announcement.kind}`}>{announcement.kind === "outage" ? "Algemene storing" : "Mededeling"}</span><h3>{announcement.title}</h3></div>{announcement.publishedAt !== null && <time dateTime={new Date(announcement.publishedAt).toISOString()}><Clock3 size={12} aria-hidden="true" /> {new Date(announcement.publishedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}</time>}</div>
            <p>{announcement.description}</p>
            <div className="public-announcement-services"><strong>Getroffen diensten</strong>{announcement.affectedServices.length ? announcement.affectedServices.map((service) => <span key={service.id}>{service.name}</span>) : <span>Algemene mededeling</span>}</div>
          </div>
        </article>)}</div>
      </section>}

      {activeIncidents.length > 0 && <section className={`active-incidents ${activeIncidents.some((incident) => incident.status === "down") ? "has-outage" : "has-warning"}${activeIncidentsCollapsed ? " is-collapsed" : ""}`} aria-labelledby="active-incidents-title" id="active-incidents-section">
        <h2 className="active-incidents-heading" id="active-incidents-title"><button type="button" className="active-incidents-toggle" aria-expanded={!activeIncidentsCollapsed} aria-controls="active-incident-list" onClick={() => setActiveIncidentsCollapsed((collapsed) => !collapsed)}>
          <ShieldAlert size={17} aria-hidden="true" /><span>Actieve incidenten</span><span className="active-incidents-summary">{activeIncidents.map((incident) => incident.serviceName).join(" · ")}</span><span className="active-incidents-count">{activeIncidents.length} actief</span><ChevronDown className="active-incidents-chevron" size={16} aria-hidden="true" />
        </button></h2>
        <div className="active-incident-list" id="active-incident-list" hidden={activeIncidentsCollapsed}>
          {activeIncidents.map((incident) => (
            <article className={`active-incident-card is-${incident.status}`} key={incident.id}>
              <span className="active-incident-indicator" aria-hidden="true" />
              <div className="active-incident-copy">
                <div className="active-incident-title"><strong>{incident.serviceName}</strong><span className="active-incident-state">{statusLabels[incident.status]}</span></div>
                <p>{incident.reason}</p>
              </div>
              <span className="active-incident-duration"><Clock3 size={13} aria-hidden="true" /> Al {formatIncidentDuration(incident.startedAt)}</span>
            </article>
          ))}
        </div>
      </section>}

      <section className="service-browser" aria-labelledby="services-title">
        <div className="service-browser-heading"><div className="service-browser-title"><Layers3 size={23} aria-hidden="true" /><h2 id="services-title">Diensten</h2></div>
          <div className="service-browser-controls">
            <div className="service-view-switch" role="group" aria-label="Kies dienstenweergave">
              <button type="button" className={preferences.serviceView === "cards" ? "is-selected" : ""} aria-pressed={preferences.serviceView === "cards"} onClick={() => updatePreference("serviceView", "cards")}><LayoutGrid size={15} aria-hidden="true" /><span>Overzicht</span></button>
              <button type="button" className={preferences.serviceView === "table" ? "is-selected" : ""} aria-pressed={preferences.serviceView === "table"} onClick={() => updatePreference("serviceView", "table")}><List size={15} aria-hidden="true" /><span>Tabel</span></button>
            </div>
          </div>
        </div>
        <div className="service-filter-row"><label className="service-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Zoek diensten</span><input type="search" value={preferences.searchQuery} onChange={(event) => updatePreference("searchQuery", event.target.value)} placeholder="Zoek een dienst…" /></label><div className="service-filters" role="group" aria-label="Filter diensten op status">
          {([{ id: "all", label: "Alle", count: activeServices.length }, { id: "attention", label: "Aandacht", count: attentionCount }, { id: "operational", label: "Operationeel", count: onlineCount }] as const).map((filter) => <button key={filter.id} type="button" className={`filter-${filter.id}${preferences.statusFilter === filter.id ? " is-selected" : ""}`} aria-pressed={preferences.statusFilter === filter.id} onClick={() => updatePreference("statusFilter", filter.id)}>{filter.id === "attention" ? <TriangleAlert size={14} aria-hidden="true" /> : filter.id === "operational" ? <CircleCheck size={14} aria-hidden="true" /> : null}{filter.label}{preferences.showMetrics && <span>{loading ? "—" : filter.count}</span>}</button>)}
        </div></div>

        <section className="history-dashboard history-in-browser" aria-labelledby="history-dashboard-title">
          <div className="history-dashboard-copy"><Activity size={18} aria-hidden="true" /><h2 id="history-dashboard-title">Beschikbaarheid</h2></div>
          <div className="history-toolbar">
            <div className="history-control-set"><span className="history-control-label">Periode:</span><div className="history-control-options" role="group" aria-label="Kies de periode">
              {(["1h", "12h", "24h"] as Range[]).map((option) => <button key={option} type="button" className={range === option ? "is-selected" : ""} aria-pressed={range === option} onClick={() => { previousStatuses.current = null; updatePreference("range", option); }}>{rangeLabels[option]}</button>)}
            </div></div>
            {preferences.serviceView === "cards" && <div className="history-control-set"><span className="history-control-label">Uptimeweergave:</span><div className="history-control-options" role="group" aria-label="Kies hoe uptime wordt weergegeven">
              {([{ id: "timeline", label: "Tijdlijn" }, { id: "heartbeat", label: "Hartslag" }, { id: "summary", label: "Uptime" }] as const).map((option) => <button key={option.id} type="button" className={preferences.uptimeView === option.id ? "is-selected" : ""} aria-pressed={preferences.uptimeView === option.id} onClick={() => updatePreference("uptimeView", option.id)}>{option.id === "timeline" ? <ChartNoAxesColumn size={13} aria-hidden="true" /> : option.id === "heartbeat" ? <HeartPulse size={13} aria-hidden="true" /> : <Clock3 size={13} aria-hidden="true" />}{option.label}</button>)}
            </div></div>}
          </div>
        </section>

      {preferences.serviceView === "cards" ? <div className="service-groups">
        {groups.map((group) => {
          const groupServices = filteredServices.filter((service) => service.category === group);
          const groupOnlineCount = groupServices.filter((service) => service.status === "operational").length;
          const groupStatus = summarize(groupServices);
          const collapsed = Boolean(collapsedGroups[group]);
          return (
            <section className="service-section" key={group}>
              <div className="section-heading service-group-heading-row">
                <h2 className="service-group-heading"><button type="button" className="service-group-toggle" aria-expanded={!collapsed} aria-label={`${group}: ${groupOnlineCount} van ${groupServices.length} online`} onClick={() => setCollapsedGroups((current) => ({ ...current, [group]: !current[group] }))}>
                  <span className="service-group-icon"><CategorySymbol category={group} /></span>
                  <span className="service-group-title">{group}</span>
                  <span className={`group-summary is-${groupStatus}`}><span className="group-dot" aria-hidden="true" />{groupOnlineCount} van {groupServices.length} online</span>
                  <ChevronDown className="service-group-chevron" size={19} aria-hidden="true" />
                </button></h2>
              </div>
              {!collapsed && <div className={`service-list${groupServices.length === 1 ? " is-single" : ""}`}>
              {groupServices.map((service) => (
                <article className="service-row" key={service.id}>
                  <div className="service-main">
                    <ServiceVisual service={service} />
                    <div className="service-name-wrap">
                      <div className="service-name-heading"><span className="service-name">{service.name}</span><span className={`status-pill is-${service.status}`}><span className="pill-dot" />{statusLabels[service.status]}</span></div>
                      {service.status === "maintenance" ? <p className="service-maintenance-reason"><Wrench size={14} aria-hidden="true" /><span>{service.maintenanceMessage || service.message}</span></p> : service.status === "operational" || service.status === "unknown" ? <span className="service-message">{service.status === "unknown" ? service.message || "Deze dienst is nog niet gecontroleerd." : `Reageert normaal${service.responseMs !== null ? ` · ${service.responseMs} ms` : ""}`}</span> : (
                        <>
                          <button className="service-details-toggle" onClick={() => setOpenDetails(openDetails === service.id ? null : service.id)} aria-expanded={openDetails === service.id}>
                            {openDetails === service.id ? "Verberg details" : "Bekijk storingsreden"}
                          </button>
                          {openDetails === service.id && <div className={`service-detail is-${service.status}`} role="note"><strong>{statusLabels[service.status]}</strong><span>{service.message}</span><small>Gecontroleerd om {new Date(service.checkedAt ?? Date.now()).toLocaleTimeString("nl-NL")}{service.responseMs !== null ? ` · ${service.responseMs} ms` : ""}</small></div>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`service-extra${service.kind === "fivem" && service.players !== null && service.players !== undefined ? " has-players" : ""}`}>
                    {service.kind === "fivem" && service.players !== null && service.players !== undefined && <span className="players-count"><span className="players-count-icon"><Radio size={17} aria-hidden="true" /></span><span className="players-count-copy"><span className="players-count-label">Spelers online</span><span className="players-count-value"><strong>{service.players}</strong>{service.maxPlayers !== null && service.maxPlayers !== undefined && <small> / {service.maxPlayers}</small>}</span></span></span>}
                    <UptimeBars key={`${service.id}-${range}`} history={service.history} status={service.status} range={range} uptime={service.uptime} view={preferences.uptimeView} />
                  </div>
                </article>
              ))}
              </div>}
            </section>
          );
        })}
        {!loading && activeServices.length === 0 && <div className="empty-group">Er zijn nog geen diensten toegevoegd.</div>}
        {loading && activeServices.length === 0 && <div className="loading-services" role="status"><span className="loading-spinner" aria-hidden="true" />Dienstenstatus wordt opgehaald…</div>}
        {!loading && activeServices.length > 0 && filteredServices.length === 0 && <div className="empty-group"><strong>Geen diensten gevonden</strong><span>Pas je zoekopdracht of filter aan.</span><button type="button" onClick={clearServiceFilters}>Wis filters</button></div>}
      </div> : <div className="service-table-wrap"><table className="service-table"><thead><tr>{preferences.visibleColumns.map((column) => <th key={column} scope="col" aria-sort={sortColumn === column ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => changeSort(column)}>{serviceColumnLabels[column]}<span aria-hidden="true">{sortColumn === column ? sortDirection === "asc" ? " ↑" : " ↓" : " ↕"}</span></button></th>)}</tr></thead><tbody>
        {sortedServices.map((service) => <tr key={service.id}>
          {preferences.visibleColumns.map((column) => <td key={column}>{column === "name" ? <div><strong className="table-service-name">{service.name}</strong>{service.status === "maintenance" && <p className="service-maintenance-reason">{service.maintenanceMessage || service.message}</p>}</div> : column === "category" ? service.category : column === "status" ? <span className={`status-pill is-${service.status}`}><span className="pill-dot" />{statusLabels[service.status]}</span> : column === "uptime" ? service.uptime === null || service.uptime === undefined ? "—" : `${Number.isInteger(service.uptime) ? service.uptime : service.uptime.toFixed(2)}%` : column === "response" ? service.responseMs === null ? "—" : `${service.responseMs} ms` : service.players === null || service.players === undefined ? "—" : `${service.players}/${service.maxPlayers ?? "?"}`}</td>)}
        </tr>)}
        {loading && sortedServices.length === 0 && <tr><td className="table-empty" colSpan={preferences.visibleColumns.length}>Status wordt geladen…</td></tr>}
        {!loading && activeServices.length === 0 && <tr><td className="table-empty" colSpan={preferences.visibleColumns.length}>Er zijn nog geen diensten toegevoegd.</td></tr>}
        {!loading && activeServices.length > 0 && filteredServices.length === 0 && <tr><td className="table-empty" colSpan={preferences.visibleColumns.length}><span>Geen diensten gevonden. Pas je zoekopdracht of filter aan.</span> <button type="button" onClick={clearServiceFilters}>Wis filters</button></td></tr>}
        </tbody></table></div>}
      </section>

      {preferences.showResolvedIncidents && <details className="incidents-section" aria-labelledby="incidents-title" open>
        <summary className="section-heading incidents-heading">
          <ShieldAlert size={18} aria-hidden="true" />
          <span id="incidents-title" className="incident-heading-title" role="heading" aria-level={2}>Incidentenoverzicht</span>
          <span className="section-count">{resolvedIncidents.length} opgelost</span>
          <ChevronDown className="incident-chevron" size={18} aria-hidden="true" />
        </summary>
        {resolvedIncidents.length ? <div className="incident-list">{resolvedIncidents.map((incident) => (
          <article className="incident-card is-resolved" key={incident.id}>
            <span className="incident-indicator is-operational" />
            <div className="incident-main"><div className="incident-title"><strong>{incident.serviceName}</strong><span className="incident-state is-operational">Opgelost</span></div><p>{incident.reason}</p><div className="incident-times"><span>Gestart {new Date(incident.startedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}</span><span>Opgelost {new Date(incident.resolvedAt ?? incident.startedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}</span></div></div>
          </article>
        ))}</div> : <div className="incident-empty"><Check size={16} /> Er zijn nog geen opgeloste incidenten.</div>}
      </details>}

      <footer className="page-footer"><span><ShieldCheck size={15} /> Statusmetingen worden automatisch bijgewerkt.</span><nav className="footer-links" aria-label="Footer"><CreatorCredit /><Link href="/admin">Beheer <ArrowUpRight size={13} /></Link></nav></footer>
      <p className="footnote">Een dienst kan bereikbaar zijn terwijl de bijbehorende applicatie zelf een storing toont. Reactietijden zijn gemeten vanaf de statusdienst.</p>
    </main>
  );
}
