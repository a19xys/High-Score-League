"use client";

import { useEffect } from "react";
import { PRESENCE_HEARTBEAT_INTERVAL_MS } from "@/lib/player-presence";

const CLIENT_ID_KEY = "hsl.presence.web.clientId";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function browserClientId() {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored && uuidPattern.test(stored)) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function WebPresenceHeartbeat({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const clientId = browserClientId();
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let disposed = false;

    const heartbeat = async () => {
      if (disposed || inFlight || document.visibilityState === "hidden" || !navigator.onLine) return;
      inFlight = true;
      try {
        await fetch("/api/presence/web", {
          body: JSON.stringify({ version: 1, clientId }),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      } catch {
        // Presence is social and best-effort; it never surfaces a global error.
      } finally {
        inFlight = false;
      }
    };
    const schedule = () => {
      if (timer !== null) clearInterval(timer);
      timer = document.visibilityState === "visible"
        ? setInterval(() => void heartbeat(), PRESENCE_HEARTBEAT_INTERVAL_MS)
        : null;
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      schedule();
      void heartbeat();
    };
    const visibility = () => {
      schedule();
      if (document.visibilityState === "visible") void heartbeat();
    };

    schedule();
    void heartbeat();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("hsl:presence-preference-changed", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      if (timer !== null) clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("hsl:presence-preference-changed", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);

  return null;
}

