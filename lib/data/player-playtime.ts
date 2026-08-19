import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerPlayTimeDto } from "@/lib/playtime";

type PlayTimeAccess = {
  isOwner: boolean;
  playTimePublic: boolean;
};

export type PlayerPlayTimeReadResult =
  | { ok: true; playTime: PlayerPlayTimeDto }
  | { ok: false; error: "read-failed" };

export type PlayerPlayTimeSnapshotReadResult =
  | { ok: true; playTime: PlayerPlayTimeDto }
  | { ok: false; error: "not-found" | "read-failed" };

type PlayerPlayTimeSnapshotRow = {
  id: string;
  play_time_public: boolean;
  play_time_total:
    | { total_seconds: number | string }
    | { total_seconds: number | string }[]
    | null;
};

function snapshotTotal(
  relation: PlayerPlayTimeSnapshotRow["play_time_total"],
) {
  if (relation === null) return { ok: true as const, totalSeconds: 0 };
  const row = Array.isArray(relation)
    ? relation.length === 0
      ? null
      : relation.length === 1
        ? relation[0]
        : undefined
    : relation;
  if (row === undefined) return { ok: false as const };
  if (row === null) return { ok: true as const, totalSeconds: 0 };
  const totalSeconds = Number(row.total_seconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return { ok: false as const };
  }
  return { ok: true as const, totalSeconds: Math.floor(totalSeconds) };
}

export async function getPlayerPlayTimeSnapshot(
  supabase: SupabaseClient,
  username: string,
  viewerUserId: string,
): Promise<PlayerPlayTimeSnapshotReadResult> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(`
        id,
        play_time_public,
        play_time_total:player_play_time_totals(total_seconds)
      `)
      .eq("username", username)
      .is("anonymized_at", null)
      .maybeSingle<PlayerPlayTimeSnapshotRow>();

    if (error) return { ok: false, error: "read-failed" };
    if (!data) return { ok: false, error: "not-found" };

    const isOwner = data.id === viewerUserId;
    if (!isOwner && data.play_time_public !== true) {
      return { ok: true, playTime: { visibility: "private" } };
    }

    const total = snapshotTotal(data.play_time_total);
    if (!total.ok) return { ok: false, error: "read-failed" };
    return {
      ok: true,
      playTime: {
        visibility: "visible",
        totalSeconds: total.totalSeconds,
      },
    };
  } catch {
    return { ok: false, error: "read-failed" };
  }
}

export async function getPlayerPlayTime(
  supabase: SupabaseClient,
  playerId: string,
  access: PlayTimeAccess,
): Promise<PlayerPlayTimeReadResult> {
  if (!access.isOwner && !access.playTimePublic) {
    return { ok: true, playTime: { visibility: "private" } };
  }
  try {
    const { data, error } = await supabase
      .from("player_play_time_totals")
      .select("total_seconds")
      .eq("player_id", playerId)
      .maybeSingle<{ total_seconds: number | string }>();

    if (error) return { ok: false, error: "read-failed" };

    if (data != null && data.total_seconds == null) {
      return { ok: false, error: "read-failed" };
    }
    const totalSeconds = data == null ? 0 : Number(data.total_seconds);
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
      return { ok: false, error: "read-failed" };
    }

    return {
      ok: true,
      playTime: {
        visibility: "visible",
        totalSeconds: Math.floor(totalSeconds),
      },
    };
  } catch {
    return { ok: false, error: "read-failed" };
  }
}
