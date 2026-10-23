"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const THEME_KEY = "amrp-status-theme";
const THEME_EVENT = "amrp-status-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): "light" | "dark" {
  return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

function getServerSnapshot(): "light" {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    window.localStorage.setItem(THEME_KEY, next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button className="theme-toggle" type="button" onClick={toggle} aria-label={theme === "light" ? "Donker thema inschakelen" : "Licht thema inschakelen"} title={theme === "light" ? "Donker thema" : "Licht thema"}>
      {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  );
}
