"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function CreatorCredit() {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let activeRequest: AbortController | null = null;

    async function refreshAvatar() {
      if (disposed || document.visibilityState !== "visible" || activeRequest) return;

      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch("/api/creator-avatar?format=json", { signal: controller.signal });
        if (!response.ok) return;

        const data: unknown = await response.json();
        if (disposed || controller.signal.aborted || !data || typeof data !== "object" || !("avatarUrl" in data)) return;
        if (data.avatarUrl !== null && typeof data.avatarUrl !== "string") return;

        setAvatarUrl(data.avatarUrl);
        setAvatarFailed(false);
      } catch {
        // Keep the last known photo; a later refresh retries automatically.
      } finally {
        window.clearTimeout(timeout);
        activeRequest = null;
      }
    }

    const refresh = () => { void refreshAvatar(); };
    refresh();
    const interval = window.setInterval(refresh, 900_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      activeRequest?.abort();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <a
      className="creator-credit"
      href="https://discord.com/users/960090714950225970"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="by Gilles — open Discord-profiel"
    >
      {avatarUrl && !avatarFailed && (
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcSet={avatarUrl.replace("&animated=true", "")} />
          <Image
            className="creator-avatar"
            src={avatarUrl}
            alt=""
            width={22}
            height={22}
            unoptimized
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        </picture>
      )}
      <span className="creator-credit-copy">by <strong>Gilles</strong></span>
    </a>
  );
}
