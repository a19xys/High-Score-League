"use client";

import { useEffect, useState } from "react";
import type { PlayerPresence } from "@/lib/player-presence";
import { PlayerPresenceIndicator } from "@/components/player-presence-indicator";

const POLL_INTERVAL_MS = 15_000;

export function ProfilePresenceStat({
  initialPresence,
  username,
}: {
  initialPresence: PlayerPresence;
  username: string;
}) {
  const [presence, setPresence] = useState(initialPresence);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;
    let inFlight = false;

    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch(`/api/players/${encodeURIComponent(username)}/presence`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const body = await response.json();
        if (!disposed && body?.ok && body.presence?.visibility !== "unavailable") {
          setPresence(body.presence as PlayerPresence);
        }
      } catch {
        // Keep the last valid state; a read failure is not a false disconnection.
      } finally {
        inFlight = false;
      }
    };
    const schedule = () => {
      if (timer !== null) clearInterval(timer);
      timer = document.visibilityState === "visible"
        ? setInterval(() => void refresh(), POLL_INTERVAL_MS)
        : null;
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      schedule();
      void refresh();
    };
    const visibility = () => {
      schedule();
      if (document.visibilityState === "visible") void refresh();
    };

    schedule();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      if (timer !== null) clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [username]);

  return (
    <div className="relative col-span-2 flex min-w-0 flex-col overflow-hidden px-4 py-5 theme-surface sm:px-6 lg:col-span-1">
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-sky-500" />
      <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
        Estado
      </dt>
      <dd className="flex min-h-20 flex-1 items-center justify-center py-3">
        <PlayerPresenceIndicator presence={presence} />
      </dd>
    </div>
  );
}
