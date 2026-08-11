export const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;
export const PRESENCE_TTL_MS = 90_000;

export type PresenceSource = "web" | "launcher";
export type PresenceMode = "practice" | "competition";

export type PlayerPresence =
  | { visibility: "private" }
  | { visibility: "unavailable" }
  | { visibility: "visible"; status: "offline" }
  | {
      visibility: "visible";
      status: "connected";
      sources: PresenceSource[];
    }
  | {
      visibility: "visible";
      status: "playing";
      game: { id: string; title: string } | null;
    };

export type PlayerPresenceSession = {
  activity: "connected" | "playing";
  clientId?: string;
  game: { id: string; title: string } | null;
  lastSeenAt: string;
  mode: PresenceMode | null;
  source: PresenceSource;
};

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function newestFirst(left: PlayerPresenceSession, right: PlayerPresenceSession) {
  const difference = timestamp(right.lastSeenAt) - timestamp(left.lastSeenAt);
  if (difference !== 0) return difference;
  const sourceDifference = left.source.localeCompare(right.source);
  if (sourceDifference !== 0) return sourceDifference;
  return (left.clientId ?? "").localeCompare(right.clientId ?? "");
}

export function derivePlayerPresence({
  now = Date.now(),
  presencePublic,
  sessions,
}: {
  now?: number | Date;
  presencePublic: boolean;
  sessions: PlayerPresenceSession[];
}): PlayerPresence {
  if (!presencePublic) return { visibility: "private" };

  const nowMs = now instanceof Date ? now.getTime() : now;
  const cutoff = nowMs - PRESENCE_TTL_MS;
  const live = sessions.filter((session) => timestamp(session.lastSeenAt) >= cutoff);
  const playing = live
    .filter((session) => session.activity === "playing")
    .sort(newestFirst)[0];

  if (playing) {
    return {
      visibility: "visible",
      status: "playing",
      game: playing.game,
    };
  }

  const sources = (["web", "launcher"] as const).filter((source) =>
    live.some((session) => session.source === source),
  );

  return sources.length > 0
    ? { visibility: "visible", status: "connected", sources }
    : { visibility: "visible", status: "offline" };
}

