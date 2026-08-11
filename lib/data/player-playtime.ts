import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayerPlayTime } from "@/lib/playtime";

type PlayTimeAccess = {
  isOwner: boolean;
  playTimePublic: boolean;
};

export async function getPlayerPlayTime(
  supabase: SupabaseClient,
  playerId: string,
  access: PlayTimeAccess,
): Promise<PlayerPlayTime> {
  if (!access.isOwner && !access.playTimePublic) {
    return { visibility: "private" };
  }
  const { data } = await supabase
    .from("player_play_time_totals")
    .select("total_seconds")
    .eq("player_id", playerId)
    .maybeSingle<{ total_seconds: number | string }>();
  return {
    visibility: "visible",
    totalSeconds: Math.max(0, Number(data?.total_seconds) || 0),
  };
}
