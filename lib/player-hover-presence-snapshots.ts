import type { PlayerPresence } from "./player-presence";

export type PlayerHoverPresenceSnapshot =
  | { resolved: false; presence: null }
  | { resolved: true; presence: PlayerPresence | null };

const snapshots = new Map<string, PlayerPresence | null>();

export function getPlayerHoverPresenceSnapshot(
  playerKey: string,
): PlayerHoverPresenceSnapshot {
  if (!snapshots.has(playerKey)) {
    return { resolved: false, presence: null };
  }

  return {
    resolved: true,
    presence: snapshots.get(playerKey) ?? null,
  };
}

export function rememberPlayerHoverPresence(
  playerKey: string,
  presence: PlayerPresence | null,
) {
  snapshots.set(playerKey, presence);
}

export function resetPlayerHoverPresenceSnapshots() {
  snapshots.clear();
}
