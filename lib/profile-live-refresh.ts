import type { PlayerPlayTimeDto } from "@/lib/playtime";
import type { PlayerPresence } from "@/lib/player-presence";

export const PROFILE_LIVE_POLL_INTERVAL_MS = 15_000;
export const PROFILE_LIVE_LANE_TIMEOUT_MS = 10_000;

type VisibilityState = "hidden" | "visible";
type Listener = () => void;

export type ProfileLiveRefreshEnvironment = {
  getVisibilityState: () => VisibilityState;
  setInterval: (listener: Listener, delay: number) => unknown;
  clearInterval: (timer: unknown) => void;
  setTimeout: (listener: Listener, delay: number) => unknown;
  clearTimeout: (timer: unknown) => void;
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
  laneTimeoutMs?: number;
};

type Lane<T> = {
  controller: AbortController | null;
  generation: number;
  inFlight: boolean;
  releaseWait: (() => void) | null;
  timeout: unknown;
  read: (signal: AbortSignal) => Promise<T | null>;
  apply: (value: T) => void;
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
  laneTimeoutMs = PROFILE_LIVE_LANE_TIMEOUT_MS,
}: ProfileLiveRefreshOptions) {
  let timer: unknown = null;
  let disposed = false;
  const createLane = <T>(
    read: (signal: AbortSignal) => Promise<T | null>,
    apply: (value: T) => void,
  ): Lane<T> => ({
    apply,
    controller: null,
    generation: 0,
    inFlight: false,
    read,
    releaseWait: null,
    timeout: null,
  });
  const presenceLane = createLane(readPresence, applyPresence);
  const playTimeLane = createLane(readPlayTime, applyPlayTime);

  const advanceLane = async <T>(lane: Lane<T>) => {
    if (disposed || lane.inFlight) return;

    lane.inFlight = true;
    const requestGeneration = ++lane.generation;
    const controller = new AbortController();
    lane.controller = controller;

    let waitReleased = false;
    const timeoutResult = new Promise<{ kind: "cancelled" | "timeout" }>((resolve) => {
      const settle = (kind: "cancelled" | "timeout") => {
        if (waitReleased) return;
        waitReleased = true;
        resolve({ kind });
      };
      lane.releaseWait = () => settle("cancelled");
      lane.timeout = environment.setTimeout(() => {
        controller.abort();
        settle("timeout");
      }, laneTimeoutMs);
    });
    const readResult = Promise.resolve()
      .then(() => lane.read(controller.signal))
      .then(
        (value) => ({ kind: "value" as const, value }),
        () => ({ kind: "error" as const }),
      );

    try {
      const result = await Promise.race([readResult, timeoutResult]);
      if (disposed || requestGeneration !== lane.generation) return;
      if (result.kind === "value" && result.value) lane.apply(result.value);
    } finally {
      if (requestGeneration === lane.generation) {
        if (lane.timeout !== null) environment.clearTimeout(lane.timeout);
        lane.releaseWait?.();
        lane.controller = null;
        lane.inFlight = false;
        lane.releaseWait = null;
        lane.timeout = null;
      }
    }
  };

  const refresh = async () => {
    if (
      disposed
      || environment.getVisibilityState() === "hidden"
    ) {
      return;
    }
    await Promise.allSettled([
      advanceLane(presenceLane),
      advanceLane(playTimeLane),
    ]);
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
      for (const lane of [presenceLane, playTimeLane]) {
        lane.generation += 1;
        lane.controller?.abort();
        if (lane.timeout !== null) environment.clearTimeout(lane.timeout);
        lane.releaseWait?.();
        lane.controller = null;
        lane.inFlight = false;
        lane.releaseWait = null;
        lane.timeout = null;
      }
      if (timer !== null) environment.clearInterval(timer);
      timer = null;
      environment.removeFocusListener(resume);
      environment.removeVisibilityListener(visibility);
    },
  };
}
