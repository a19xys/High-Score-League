import type { SupabaseClient } from "@supabase/supabase-js";
import { adminGameColumns } from "@/lib/admin/games";
import type { GameRow } from "@/types/supabase";

export async function getAdminGames(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("games")
    .select(adminGameColumns)
    .order("title", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }

  return { rows: (data ?? []) as GameRow[], error: null };
}

export async function getAdminGameById(
  supabase: SupabaseClient,
  gameId: string,
) {
  const [game, weeks] = await Promise.all([
    supabase
      .from("games")
      .select(adminGameColumns)
      .eq("id", gameId)
      .maybeSingle<GameRow>(),
    supabase
      .from("weeks")
      .select("id", { count: "exact", head: true })
      .eq("game_id", gameId),
  ]);

  const error = game.error ?? weeks.error;

  if (error) {
    return { row: null, usageCount: 0, error: error.message };
  }

  return { row: game.data, usageCount: weeks.count ?? 0, error: null };
}
