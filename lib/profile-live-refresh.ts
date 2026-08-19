import type { PlayerPlayTimeDto } from "@/lib/playtime";
import type { PlayerPresence } from "@/lib/player-presence";

export const PROFILE_LIVE_POLL_INTERVAL_MS = 15_000;

type VisibilityState = "hidden" | "visible";
type Listener = () => void;

export type ProfileLiveRefreshEnvironment = {
  getVisibilityState: () => VisibilityState;
  setInterval: (listener: Listener, delay: number) => unknown;
  clearInterval: (timer: unknown) => void;
  addFocusListener: (listener: Listener) => void;
  removeFocusListener: (listener: Listener) => void;
  addVisibilityListener: (listener: Listener) => void;
  removeVisibilityListener: (listener: Listener) => void;
};

type ProfileLiveRefreshOptions = {
  environment: ProfileLiveRefreshEnvironment;
  readPlayTime: (signal: AbortSignal) => Promise<PlayerPlayTimeDto | null>;
  readPresence: (signal: AbortSignal) => Promise<PlayerPresence | null>;
  applyPlayTime: (playTime: PlayerPlayTimeDto) => void;
  applyPresence: (presence: PlayerPresence) => void;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

export function parsePlayerPlayTimeResponse(
  value: unknown,
): PlayerPlayTimeDto | null {
  const body = record(value);
  const playTime = record(body?.playTime);
  if (body?.ok !== true || !playTime) return null;
  if (playTime.visibility === "private") return { visibility: "private" };
  if (
    playTime.visibility !== "visible"
    || typeof playTime.totalSeconds !== "number"
    || !Number.isFinite(playTime.totalSeconds)
    || playTime.totalSeconds < 0
  ) {
    return null;
  }
  return {
    visibility: "visible",
    totalSeconds: Math.floor(playTime.totalSeconds),
  };
}

export function parsePlayerPresenceResponse(
  value: unknown,
): PlayerPresence | null {
  const body = record(value);
  const presence = record(body?.presence);
  if (body?.ok !== true || !presence) return null;

  if (presence.visibility === "private") return { visibility: "private" };
  if (presence.visibility !== "visible") return null;
  if (presence.status === "offline") {
    return { visibility: "visible", status: "offline" };
  }
  if (presence.status === "connected") {
    if (
      !Array.isArray(presence.sources)
      || presence.sources.some((source) => source !== "web" && source !== "launcher")
    ) {
      return null;
    }
    return {
      visibility: "visible",
      status: "connected",
      sources: [...new Set(presence.sources)] as ("web" | "launcher")[],
    };
  }
  if (presence.status === "playing") {
    if (presence.game === null) {
      return { visibility: "visible", status: "playing", game: null };
    }
    const game = record(presence.game);
    if (!game || typeof game.id !== "string" || typeof game.title !== "string") {
      return null;
    }
    return {
      visibility: "visible",
      status: "playing",
      game: { id: game.id, title: game.title },
    };
  }
  return null;
}

export function createProfileLiveRefreshLifecycle({
  environment,
  readPlayTime,
  readPresence,
  applyPlayTime,
  applyPresence,
}: ProfileLiveRefreshOptions) {
  let timer: unknown = null;
  let disposed = false;
  let inFlight = false;
  let generation = 0;
  let requestController: AbortController | null = null;

  const refresh = async () => {
    if (
      disposed
      || inFlight
      || environment.getVisibilityState() === "hidden"
    ) {
      return;
    }

    inFlight = true;
    const requestGeneration = ++generation;
    const controller = new AbortController();
    requestController = controller;

    try {
      const [presenceResult, playTimeResult] = await Promise.allSettled([
        readPresence(controller.signal),
        readPlayTime(controller.signal),
      ]);
      if (disposed || requestGeneration !== generation) return;

      if (presenceResult.status === "fulfilled" && presenceResult.value) {
        applyPresence(presenceResult.value);
      }
      if (playTimeResult.status === "fulfilled" && playTimeResult.value) {
        applyPlayTime(playTimeResult.value);
      }
    } finally {
      if (requestGeneration === generation) {
        inFlight = false;
        requestController = null;
      }
    }
  };

  const schedule = () => {
    if (timer !== null) environment.clearInterval(timer);
    timer = environment.getVisibilityState() === "visible"
      ? environment.setInterval(
          () => void refresh(),
          PROFILE_LIVE_POLL_INTERVAL_MS,
        )
      : null;
  };
  const resume = () => {
    if (environment.getVisibilityState() !== "visible") return;
    schedule();
    void refresh();
  };
  const visibility = () => {
    schedule();
    if (environment.getVisibilityState() === "visible") void refresh();
  };

  schedule();
  environment.addFocusListener(resume);
  environment.addVisibilityListener(visibility);

  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      requestController?.abort();
      if (timer !== null) environment.clearInterval(timer);
      timer = null;
      environment.removeFocusListener(resume);
      environment.removeVisibilityListener(visibility);
    },
  };
}
