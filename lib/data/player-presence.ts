import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  derivePlayerPresence,
  PRESENCE_TTL_MS,
  type PlayerPresence,
  type PlayerPresenceSession,
  type PresenceMode,
  type PresenceSource,
} from "@/lib/player-presence";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = SupabaseClient;

export async function commitPlayerPresence(
  admin: AdminClient,
  input: {
    activity: "connected" | "playing";
    clientId: string;
    mode: PresenceMode | null;
    playerId: string;
    source: PresenceSource;
    weekId: string | null;
  },
) {
  const { data, error } = await admin.rpc("commit_player_presence", {
    p_activity: input.activity,
    p_client_id: input.clientId,
    p_mode: input.mode,
    p_player_id: input.playerId,
    p_source: input.source,
    p_week_id: input.weekId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return { error, private: row?.private === true };
}

export async function clearPlayerPresence(
  admin: AdminClient,
  input: { clientId: string; playerId: string; source: PresenceSource },
) {
  return admin.rpc("clear_player_presence", {
    p_client_id: input.clientId,
    p_player_id: input.playerId,
    p_source: input.source,
  });
}

export async function getPlayerPresence(
  playerId: string,
  options: { admin?: AdminClient | null; now?: Date } = {},
): Promise<PlayerPresence> {
  const admin = options.admin === undefined ? createSupabaseAdminClient() : options.admin;
  if (!admin) return { visibility: "unavailable" };

  const profileResult = await admin
    .from("profiles")
    .select("presence_public,anonymized_at")
    .eq("id", playerId)
    .maybeSingle<{ presence_public: boolean; anonymized_at: string | null }>();

  if (profileResult.error || !profileResult.data || profileResult.data.anonymized_at) {
    return { visibility: "unavailable" };
  }
  if (!profileResult.data.presence_public) return { visibility: "private" };

  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - PRESENCE_TTL_MS).toISOString();
  const sessionsResult = await admin
    .from("player_presence_sessions")
    .select("source,activity,client_id,game_id,mode,last_seen_at")
    .eq("player_id", playerId)
    .gte("last_seen_at", cutoff);

  if (sessionsResult.error) return { visibility: "unavailable" };
  const rows = (sessionsResult.data ?? []) as Array<{
    activity: "connected" | "playing";
    client_id: string;
    game_id: string | null;
    last_seen_at: string;
    mode: PresenceMode | null;
    source: PresenceSource;
  }>;
  const gameIds = [...new Set(rows.map((row) => row.game_id).filter((id): id is string => Boolean(id)))];
  const gamesResult = gameIds.length > 0
    ? await admin.from("games").select("id,title").in("id", gameIds)
    : { data: [], error: null };
  if (gamesResult.error) return { visibility: "unavailable" };
  const games = new Map(
    ((gamesResult.data ?? []) as Array<{ id: string; title: string }>).map((game) => [game.id, game] as const),
  );
  const sessions: PlayerPresenceSession[] = rows.map((row) => ({
    activity: row.activity,
    clientId: row.client_id,
    game: row.game_id ? games.get(row.game_id) ?? null : null,
    lastSeenAt: row.last_seen_at,
    mode: row.mode,
    source: row.source,
  }));

  return derivePlayerPresence({ now, presencePublic: true, sessions });
}

