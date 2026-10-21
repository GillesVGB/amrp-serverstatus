"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "amrp-status-theme";
const THEME_EVENT = "amrp-status-theme-change";
let fallbackTheme: ThemeMode = "system";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return fallbackTheme;
  }
}

function getServerSnapshot(): ThemeMode {
  return "system";
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => { document.documentElement.dataset.theme = mode === "system" ? (media.matches ? "dark" : "light") : mode; };
    applyTheme();
    if (mode !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [mode]);

  function toggle() {
    const next: ThemeMode = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
    fallbackTheme = next;
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* Keep the selected theme for this page when storage is unavailable. */ }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  const modeLabels: Record<ThemeMode, string> = { system: "Systeem", light: "Licht", dark: "Donker" };
  const nextLabels: Record<ThemeMode, string> = { system: "licht", light: "donker", dark: "systeem" };
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={`Thema ${modeLabels[mode]}. Klik om ${nextLabels[mode]} te kiezen.`} title={`Thema: ${modeLabels[mode]}`}>
    {mode === "system" ? <Monitor size={17} /> : mode === "light" ? <Moon size={17} /> : <Sun size={17} />}
  </button>;
}
