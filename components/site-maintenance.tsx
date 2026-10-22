"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Wrench } from "lucide-react";

export function SiteMaintenance() {
  const router = useRouter();

  useEffect(() => {
    let activeRequest: AbortController | null = null;
    let disposed = false;
    async function check() {
      if (disposed || activeRequest || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/site-state", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const state = await response.json() as { maintenance?: unknown };
        if (!disposed && !controller.signal.aborted && state.maintenance === false) router.refresh();
      } catch {
        // Stay on the maintenance page until the server confirms it is open.
      } finally {
        window.clearTimeout(timeout);
        activeRequest = null;
      }
    }
    const refresh = () => { void check(); };
    const interval = window.setInterval(refresh, 15_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      activeRequest?.abort();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return (
    <main className="site-maintenance-page">
      <section className="site-maintenance-card" aria-labelledby="site-maintenance-title">
        <Image src="/amsterdam-logo.png" alt="Amsterdam Roleplay" width={60} height={60} priority />
        <p className="eyebrow">AMSTERDAM ROLEPLAY · SYSTEEMSTATUS</p>
        <span className="site-maintenance-label"><Wrench size={14} aria-hidden="true" /> Onderhoud</span>
        <h1 id="site-maintenance-title">We zijn even in onderhoud.</h1>
        <p>De statuswebsite is tijdelijk gesloten. Zodra het onderhoud klaar is, wordt deze pagina automatisch bijgewerkt.</p>
        <div className="site-maintenance-actions">
          <button className="primary-button" onClick={() => router.refresh()}>Opnieuw proberen <ArrowRight size={15} aria-hidden="true" /></button>
          <Link href="/admin" className="subtle-button">Beheerder inloggen</Link>
        </div>
      </section>
    </main>
  );
}
