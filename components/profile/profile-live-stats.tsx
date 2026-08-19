"use client";

import { useEffect, useState } from "react";
import { PlayerPresenceIndicator } from "@/components/player-presence-indicator";
import {
  createProfileLiveRefreshLifecycle,
  parsePlayerPlayTimeResponse,
  parsePlayerPresenceResponse,
} from "@/lib/profile-live-refresh";
import { formatPlayTime, type PlayerPlayTime } from "@/lib/playtime";
import type { PlayerPresence } from "@/lib/player-presence";

async function readJson(response: Response) {
  if (!response.ok) return null;
  return response.json() as Promise<unknown>;
}

export function ProfileLiveStats({
  initialPlayTime,
  initialPresence,
  username,
}: {
  initialPlayTime: PlayerPlayTime;
  initialPresence: PlayerPresence;
  username: string;
}) {
  const [playTime, setPlayTime] = useState(initialPlayTime);
  const [presence, setPresence] = useState(initialPresence);

  useEffect(() => {
    const encodedUsername = encodeURIComponent(username);
    const lifecycle = createProfileLiveRefreshLifecycle({
      environment: {
        getVisibilityState: () => document.visibilityState === "hidden"
          ? "hidden"
          : "visible",
        setInterval: (listener, delay) => window.setInterval(listener, delay),
        clearInterval: (timer) => window.clearInterval(timer as number),
        setTimeout: (listener, delay) => window.setTimeout(listener, delay),
        clearTimeout: (timer) => window.clearTimeout(timer as number),
        addFocusListener: (listener) => window.addEventListener("focus", listener),
        removeFocusListener: (listener) => window.removeEventListener("focus", listener),
        addVisibilityListener: (listener) => document.addEventListener("visibilitychange", listener),
        removeVisibilityListener: (listener) => document.removeEventListener("visibilitychange", listener),
      },
      readPresence: async (signal) => {
        const body = await readJson(await fetch(
          `/api/players/${encodedUsername}/presence`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          },
        ));
        return parsePlayerPresenceResponse(body);
      },
      readPlayTime: async (signal) => {
        const body = await readJson(await fetch(
          `/api/players/${encodedUsername}/playtime`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal,
          },
        ));
        return parsePlayerPlayTimeResponse(body);
      },
      applyPresence: setPresence,
      applyPlayTime: setPlayTime,
    });

    return () => lifecycle.dispose();
  }, [username]);

  const playTimeVisible = playTime.visibility === "visible";
  const playTimePrivate = playTime.visibility === "private";

  return (
    <>
      <div className="relative min-w-0 overflow-hidden px-4 py-5 theme-surface sm:px-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-emerald-500" />
        <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
          Tiempo jugado
        </dt>
        <dd className={`${playTimeVisible ? "text-3xl leading-none sm:text-4xl" : "text-base leading-6 sm:text-lg"} mt-2 font-black theme-text`}>
          {playTimeVisible
            ? formatPlayTime(playTime.totalSeconds)
            : playTimePrivate
              ? "Oculto"
              : "No disponible"}
        </dd>
        <p className="mt-2 hidden text-xs leading-5 theme-text-muted md:block">
          {playTimeVisible
            ? "Práctica y competición registradas por el launcher"
            : playTimePrivate
              ? "Esta información no se muestra al resto"
              : "No se pudo verificar el total en este momento"}
        </p>
      </div>
      <div className="relative flex min-w-0 flex-col overflow-hidden px-4 py-5 theme-surface sm:px-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-sky-500" />
        <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
          Estado
        </dt>
        <dd className="flex min-h-20 flex-1 items-center justify-center py-3">
          <PlayerPresenceIndicator presence={presence} />
        </dd>
      </div>
    </>
  );
}
