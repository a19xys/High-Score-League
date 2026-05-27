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
  const { data, error } = await supabase
    .from("games")
    .select(adminGameColumns)
    .eq("id", gameId)
    .maybeSingle<GameRow>();

  if (error) {
    return { row: null, error: error.message };
  }

  return { row: data, error: null };
}
