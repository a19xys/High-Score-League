import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WeeklyResult } from "@/types";
import type { RealProfile, WeeklyResultRow } from "@/types/supabase";
import { mapRealProfileToPlayer } from "./submissions";
import type { DataReadResult } from "./types";

const weeklyResultColumns = `
  id,
  week_id,
  player_id,
  final_score,
  rank,
  league_points,
  is_first_place,
  is_second_place,
  is_third_place,
  created_at,
  profiles:player_id (
    id,
    username,
    initials,
    avatar_url,
    is_admin,
    created_at,
    updated_at
  )
`;

function normalizeProfile(profile: RealProfile | RealProfile[] | null | undefined) {
  return Array.isArray(profile) ? profile[0] : profile;
}

export async function getRealWeeklyResults(
  weekId?: string,
): Promise<DataReadResult<WeeklyResultRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      rows: [],
      source: "supabase",
      error: "Supabase no esta configurado.",
      usingFallback: false,
    };
  }

  let query = supabase
    .from("weekly_results")
    .select(weeklyResultColumns)
    .order("rank", { ascending: true });

  if (weekId) {
    query = query.eq("week_id", weekId);
  }

  const { data, error } = await query;

  if (error) {
    return {
      rows: [],
      source: "supabase",
      error: error.message,
      usingFallback: false,
    };
  }

  return {
    rows: (data ?? []) as WeeklyResultRow[],
    source: "supabase",
    error: null,
    usingFallback: false,
  };
}

export function mapWeeklyResultRowToWeeklyResult(row: WeeklyResultRow): WeeklyResult {
  const profile = normalizeProfile(row.profiles);

  return {
    id: row.id,
    weekId: row.week_id,
    playerId: row.player_id,
    finalScore: row.final_score,
    rank: row.rank,
    leaguePoints: row.league_points,
    isFirstPlace: row.is_first_place,
    isSecondPlace: row.is_second_place,
    isThirdPlace: row.is_third_place,
    createdAt: row.created_at,
    player: profile ? mapRealProfileToPlayer(profile) : undefined,
  };
}
