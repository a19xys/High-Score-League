import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerPlayTimeDto } from "@/lib/playtime";

type PlayTimeAccess = {
  isOwner: boolean;
  playTimePublic: boolean;
};

export type PlayerPlayTimeReadResult =
  | { ok: true; playTime: PlayerPlayTimeDto }
  | { ok: false; error: "read-failed" };

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
