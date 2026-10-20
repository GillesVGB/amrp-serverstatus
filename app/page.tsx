"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Activity, ArrowUpRight, Bell, BellOff, Check, ChevronDown, Clock3, Radio, RefreshCw, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type Status = "operational" | "degraded" | "down" | "unknown" | "maintenance";
type Range = "1h" | "24h" | "7d";
type HistorySample = { status: Status; checkedAt: number; message: string };
type Incident = { id: number; serviceId: string; serviceName: string; status: Status; reason: string; startedAt: number; resolvedAt: number | null };
type Service = {
  id: string;
  name: string;
  category: string;
  kind: string;
  enabled: boolean;
  maintenance: boolean;
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

const rangeLabels: Record<Range, string> = { "1h": "1 uur", "24h": "24 uur", "7d": "7 dagen" };

function UptimeBars({ history, status, range }: { history: Service["history"]; status: Status; range: Range }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const filled = history;
  const selected = selectedIndex === null ? null : filled[selectedIndex] ?? null;
  return (
    <div className="uptime" aria-label={`Beschikbaarheid van de afgelopen ${rangeLabels[range]}`}>
      <div className="uptime-bars">
        {filled.map((sample, index) => (
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
      </div>
      {selectedIndex !== null && (
        <div className={`uptime-detail ${selected ? `is-${selected.status}` : "is-empty"}`} role="status">
          <div className="uptime-detail-heading">
            <strong>{selected ? statusLabels[selected.status] : "Geen meting"}</strong>
            {selected && <time dateTime={new Date(selected.checkedAt).toISOString()}>{new Date(selected.checkedAt).toLocaleString("nl-NL", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</time>}
          </div>
          <span>{selected?.message || "Voor dit tijdvak is nog geen controle opgeslagen."}</span>
        </div>
      )}
      <div className="uptime-labels"><span>{rangeLabels[range]}</span><span>nu · {status === "operational" ? "live" : "laatste meting"}</span></div>
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

export default function Home() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [range, setRange] = useState<Range>("1h");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const previousStatuses = useRef<Record<string, Status> | null>(null);
  const checking = useRef(false);

  const refresh = useCallback(async (manual = false) => {
    if (checking.current) return;
    checking.current = true;
    if (manual) setRefreshing(true);
    try {
      const response = await fetch(`/api/status?range=${range}&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("De status kon niet worden opgehaald.");
      const payload = await response.json() as { services: Service[]; incidents: Incident[]; checkedAt: number };
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
      setIncidents(payload.incidents ?? []);
      setLastChecked(payload.checkedAt);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "De status kon niet worden opgehaald.");
    } finally {
      setLoading(false);
      checking.current = false;
      if (manual) setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    const preference = setTimeout(() => setNotificationsEnabled(localStorage.getItem("amrp_status_subscribed") === "true"), 0);
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearTimeout(preference); clearTimeout(first); clearInterval(timer); };
  }, [refresh]);

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
  const groups = [...new Set(activeServices.map((service) => service.category))];
  const overall = summarize(activeServices);
  const onlineCount = activeServices.filter((service) => service.status === "operational").length;
  const checkedLabel = lastChecked ? new Date(lastChecked).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "wachten op eerste meting";

  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Amsterdam Roleplay status">
          <Image src="/amsterdam-logo.png" alt="" width={38} height={38} className="brand-mark" priority />
          <span className="brand-title">LIVE STATUS</span>
        </Link>
        <div className="topbar-right">
          <span className="live-indicator"><span className="live-dot" />Live controle</span>
          <ThemeToggle />
          <button className="refresh-button" onClick={() => void refresh(true)} disabled={refreshing} aria-label="Status vernieuwen">
            <RefreshCw size={17} className={refreshing ? "spin" : ""} /> <span>Vernieuwen</span>
          </button>
        </div>
      </header>

      <section className={`overall-banner state-${overall}`} aria-live="polite">
        <span className="overall-icon">{overall === "operational" ? <Check size={17} /> : overall === "unknown" ? <Activity size={17} /> : overall === "maintenance" ? <Clock3 size={17} /> : <ShieldAlert size={17} />}</span>
        <div className="overall-copy">
          <strong>{loading ? "Status wordt gecontroleerd…" : overall === "operational" ? "Alle systemen operationeel" : overall === "unknown" ? "Niet alle systemen kunnen worden gecontroleerd" : overall === "maintenance" ? "Een of meer diensten zijn in onderhoud" : overall === "degraded" ? "Enkele systemen reageren niet volledig" : "Er is een storing"}</strong>
          <span>{loading ? "De eerste meting duurt enkele seconden." : `${onlineCount} van ${activeServices.length} diensten operationeel · automatisch elke 5 seconden gecontroleerd`}</span>
        </div>
        <span className="overall-time"><Clock3 size={14} /> {checkedLabel}</span>
      </section>

      {error && <div className="error-banner" role="alert"><WifiOff size={17} /> {error}</div>}

      <div className="status-intro">
        <div><p className="eyebrow">AMSTERDAM ROLEPLAY</p><h1>Systeemstatus</h1><p className="intro-text">Bekijk de actuele beschikbaarheid van onze diensten en servers.</p></div>
        <div className="status-actions">
          <button className={`notification-button${notificationsEnabled ? " is-enabled" : ""}`} type="button" onClick={() => void toggleNotifications()}>{notificationsEnabled ? <BellOff size={15} /> : <Bell size={15} />}{notificationsEnabled ? "Meldingen uitzetten" : "Volg statusmeldingen"}</button>
          <a className="discord-link" href="https://amsterdamrp.nl/" target="_blank" rel="noreferrer">Amsterdam Roleplay <ArrowUpRight size={15} /></a>
        </div>
      </div>
      {notificationMessage && <p className="notification-message" role="status">{notificationMessage}</p>}

      <div className="history-controls" aria-label="Grafiekperiode">
        <span>Beschikbaarheid bekijken:</span>
        {(["1h", "24h", "7d"] as Range[]).map((option) => <button key={option} type="button" className={range === option ? "is-selected" : ""} aria-pressed={range === option} onClick={() => { previousStatuses.current = null; setRange(option); }}>{rangeLabels[option]}</button>)}
      </div>

      <div className="service-groups">
        {groups.map((group) => (
          <section className="service-section" key={group}>
            <div className="section-heading"><ChevronDown size={19} /><h2>{group}</h2><span className="section-count">{activeServices.filter((service) => service.category === group).length} diensten</span></div>
            <div className="service-list">
              {activeServices.filter((service) => service.category === group).map((service) => (
                <article className="service-row" key={service.id}>
                  <div className="service-main">
                    <span className={`status-pill is-${service.status}`}><span className="pill-dot" />{service.status === "operational" ? `${service.uptime ?? 100}%` : service.status === "degraded" ? "Let op" : service.status === "down" ? "Storing" : service.status === "maintenance" ? "Onderhoud" : "N/B"}</span>
                    <div className="service-name-wrap">
                      <span className="service-name">{service.name}</span>
                      {service.status === "operational" || service.status === "unknown" ? <span className="service-message">{service.status === "unknown" ? "Deze dienst is nog niet gecontroleerd." : `Reageert normaal${service.responseMs !== null ? ` · ${service.responseMs} ms` : ""}`}</span> : (
                        <>
                          <button className="service-details-toggle" onClick={() => setOpenDetails(openDetails === service.id ? null : service.id)} aria-expanded={openDetails === service.id}>
                            {openDetails === service.id ? "Verberg details" : service.status === "maintenance" ? "Bekijk onderhoudsmelding" : "Bekijk storingsreden"}
                          </button>
                          {openDetails === service.id && <div className={`service-detail is-${service.status}`} role="note"><strong>{statusLabels[service.status]}</strong><span>{service.message}</span><small>Gecontroleerd om {new Date(service.checkedAt ?? Date.now()).toLocaleTimeString("nl-NL")}{service.responseMs !== null ? ` · ${service.responseMs} ms` : ""}</small></div>}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="service-extra">
                    {service.kind === "fivem" && service.players !== null && service.players !== undefined && <span className="players-count"><Radio size={14} /> {service.players}/{service.maxPlayers ?? "?"} spelers</span>}
                    <UptimeBars key={`${service.id}-${range}`} history={service.history} status={service.status} range={range} />
                  </div>
                </article>
              ))}
              {!loading && !activeServices.some((service) => service.category === group) && <div className="empty-group">Geen actieve diensten in deze categorie.</div>}
            </div>
          </section>
        ))}
        {!loading && groups.length === 0 && <div className="empty-group">Er zijn nog geen diensten toegevoegd.</div>}
      </div>

      <section className="incidents-section" aria-labelledby="incidents-title">
        <div className="section-heading"><ShieldAlert size={18} /><h2 id="incidents-title">Incidentenoverzicht</h2><span className="section-count">Laatste {incidents.length}</span></div>
        {incidents.length ? <div className="incident-list">{incidents.map((incident) => (
          <article className={`incident-card${incident.resolvedAt ? " is-resolved" : " is-active"}`} key={incident.id}>
            <span className={`incident-indicator is-${incident.resolvedAt ? "operational" : incident.status}`} />
            <div className="incident-main"><div className="incident-title"><strong>{incident.serviceName}</strong><span className={`incident-state is-${incident.resolvedAt ? "operational" : incident.status}`}>{incident.resolvedAt ? "Opgelost" : statusLabels[incident.status]}</span></div><p>{incident.resolvedAt ? incident.reason : incident.reason}</p><div className="incident-times"><span>Gestart {new Date(incident.startedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}</span><span>{incident.resolvedAt ? `Opgelost ${new Date(incident.resolvedAt).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })}` : "Nog actief"}</span></div></div>
          </article>
        ))}</div> : <div className="incident-empty"><Check size={16} /> Er zijn nog geen incidenten geregistreerd.</div>}
      </section>

      <footer className="page-footer"><span><ShieldCheck size={15} /> Statusmetingen worden automatisch bijgewerkt.</span><span>Laatste controle: {checkedLabel}</span><Link href="/admin">Beheer <ArrowUpRight size={13} /></Link></footer>
      <p className="footnote">Een dienst kan bereikbaar zijn terwijl de bijbehorende applicatie zelf een storing toont. Reactietijden zijn gemeten vanaf de statusdienst.</p>
    </main>
  );
}
