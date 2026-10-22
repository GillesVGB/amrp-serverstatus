"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleCheck, LoaderCircle, RefreshCw, ShieldCheck, TriangleAlert, Wrench } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type CheckState = "idle" | "checking" | "maintenance" | "error" | "reopening";

export function SiteMaintenance({ preview = false }: { preview?: boolean }) {
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [feedback, setFeedback] = useState(preview
    ? "Dit is een voorbeeld. De onderhoudsstand van de website wordt niet gewijzigd."
    : "We controleren automatisch wanneer de website weer open is.");
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const checkAvailability = useCallback(async (manual = false) => {
    if (!mounted.current || activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setCheckState("checking");
    if (manual) setFeedback("We controleren of de statuswebsite weer beschikbaar is…");
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/site-state", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Controle niet beschikbaar");
      const state: unknown = await response.json();
      if (!mounted.current || activeRequest.current !== controller) return;
      if (controller.signal.aborted || !state || typeof state !== "object" || !("maintenance" in state) || typeof state.maintenance !== "boolean") {
        throw new Error("Geen geldige onderhoudsstatus ontvangen");
      }
      setLastChecked(Date.now());
      if (state.maintenance) {
        setCheckState("maintenance");
        setFeedback(preview
          ? "De onderhoudsstand is momenteel actief. Je bekijkt nog steeds het voorbeeld."
          : "De statuswebsite is nog in onderhoud. We blijven automatisch controleren.");
      } else if (preview) {
        setCheckState("idle");
        setFeedback("De website is momenteel openbaar. Deze voorbeeldpagina blijft geopend.");
      } else {
        setCheckState("reopening");
        setFeedback("De website is weer open. Je wordt nu doorgestuurd…");
        window.location.reload();
      }
    } catch {
      if (!mounted.current || activeRequest.current !== controller) return;
      setCheckState("error");
      setFeedback(preview
        ? "De controle is niet gelukt. Probeer het opnieuw om de huidige onderhoudsstand te controleren."
        : "De controle is niet gelukt. We proberen het automatisch opnieuw. Je kunt ook zelf opnieuw controleren.");
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [preview]);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      if (document.visibilityState === "visible") void checkAvailability();
    };
    const first = preview ? null : window.setTimeout(refresh, 0);
    const interval = preview ? null : window.setInterval(refresh, 15_000);
    if (!preview) {
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("focus", refresh);
    }
    return () => {
      mounted.current = false;
      if (first !== null) window.clearTimeout(first);
      if (interval !== null) window.clearInterval(interval);
      activeRequest.current?.abort();
      activeRequest.current = null;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [checkAvailability, preview]);

  const checking = checkState === "checking";
  const FeedbackIcon = checking ? LoaderCircle : checkState === "error" ? TriangleAlert : checkState === "reopening" ? CircleCheck : RefreshCw;

  return (
    <div className="site-maintenance-page">
      <header className="maintenance-header">
        <div className="maintenance-brand">
          <Image src="/amsterdam-logo.png" alt="" width={42} height={42} priority />
          <div><strong>Amsterdam RP</strong><span>Systeemstatus</span></div>
        </div>
        <ThemeToggle />
      </header>
      <main className="maintenance-main">
        {preview && <aside className="maintenance-preview-note"><span><strong>Voorbeeldweergave</strong> Je bekijkt de onderhoudspagina zonder de website te sluiten.</span><Link href="/admin"><ArrowLeft size={14} aria-hidden="true" /> Terug naar beheer</Link></aside>}
        <section className="maintenance-content" aria-labelledby="site-maintenance-title">
          <div className="maintenance-copy">
            <p className="maintenance-kicker"><span aria-hidden="true" /> Onderhoud aan de statuswebsite</p>
            <h1 id="site-maintenance-title">Even niet bereikbaar.<span>We zijn ermee bezig.</span></h1>
            <p className="maintenance-description">We voeren onderhoud uit aan de statuswebsite van Amsterdam Roleplay. Zodra de website weer open is, kom je automatisch terug bij het statusoverzicht.</p>
            <div className="site-maintenance-actions">
              <button type="button" className="primary-button" onClick={() => void checkAvailability(true)} disabled={checking || checkState === "reopening"} aria-busy={checking}>
                {checking ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                {checking ? "Controleren…" : checkState === "reopening" ? "Website openen…" : "Opnieuw controleren"}
              </button>
              <a className="maintenance-website-link" href="https://amsterdamrp.nl/">Naar Amsterdam RP <ArrowUpRight size={15} aria-hidden="true" /></a>
            </div>
            <div className={`maintenance-feedback is-${checkState}`}>
              <FeedbackIcon size={15} className={checking ? "spin" : undefined} aria-hidden="true" />
              <div><p role="status" aria-live="polite" aria-atomic="true">{feedback}</p>{lastChecked !== null && <span className="maintenance-last-check">Laatste succesvolle controle: <time dateTime={new Date(lastChecked).toISOString()}>{new Date(lastChecked).toLocaleTimeString("nl-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></span>}</div>
            </div>
          </div>
          <aside className="maintenance-details" aria-labelledby="maintenance-details-title">
            <span className="maintenance-tool"><Wrench size={22} aria-hidden="true" /></span>
            <h2 id="maintenance-details-title">Wat betekent dit?</h2>
            <p>Dit onderhoud betreft alleen de statuswebsite. De gekoppelde diensten worden hierdoor niet uitgeschakeld.</p>
            <dl>
              <div><dt>Statuswebsite</dt><dd>Tijdelijk gesloten</dd></div>
              <div><dt>Heropening</dt><dd>Automatisch</dd></div>
              <div><dt>{preview ? "Weergave" : "Nieuwe controle"}</dt><dd>{preview ? "Beheervoorbeeld" : "Elke 15 seconden"}</dd></div>
            </dl>
          </aside>
        </section>
      </main>
      <footer className="maintenance-footer"><span><ShieldCheck size={14} aria-hidden="true" /> Amsterdam Roleplay</span><Link href="/admin">{preview ? "Terug naar beheer" : "Beheerder inloggen"} <ArrowUpRight size={13} aria-hidden="true" /></Link></footer>
    </div>
  );
}
