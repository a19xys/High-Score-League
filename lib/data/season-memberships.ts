import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeasonMembershipRow } from "@/types/supabase";

export async function getUserSeasonMemberships(
  supabase: SupabaseClient,
  userId: string,
  seasonIds: string[],
) {
  if (seasonIds.length === 0) {
    return new Map<string, SeasonMembershipRow>();
  }

  const { data, error } = await supabase
    .from("season_memberships")
    .select("id,season_id,player_id,status,joined_at,created_at")
    .eq("player_id", userId)
    .in("season_id", seasonIds);

  if (error) {
    return new Map<string, SeasonMembershipRow>();
  }

  return new Map(
    ((data ?? []) as SeasonMembershipRow[]).map((membership) => [
      membership.season_id,
      membership,
    ]),
  );
}
