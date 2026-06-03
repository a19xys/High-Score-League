import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Game } from "@/types";
import type { GameRow } from "@/types/supabase";
import type { DataReadOptions, DataReadResult } from "./types";

const gameColumns =
  "id,title,year,developer,publisher,rom_name,genre,control_type,difficulty,image_url,instructions,manual_url,notes,created_at,updated_at";

function emptyResult(error: string | null): DataReadResult<GameRow> {
  return {
    rows: [],
    source: "supabase",
    error,
  };
}

export async function getRealGames(
  _options: DataReadOptions = {},
): Promise<DataReadResult<GameRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return emptyResult("Supabase no está configurado.");
  }

  const { data, error } = await supabase
    .from("games")
    .select(gameColumns)
    .order("title", { ascending: true });

  if (error) {
    return emptyResult(error.message);
  }

  return {
    rows: (data ?? []) as GameRow[],
    source: "supabase",
    error: null,
  };
}

export function mapGameRowToGame(row: GameRow): Game {
  return {
    id: row.id,
    title: row.title,
    slug: row.rom_name ?? row.title.toLowerCase().replaceAll(" ", "-"),
    developer: row.developer ?? "Desconocido",
    genre: row.genre ?? "Arcade",
    controlType: row.control_type ?? "estandar",
    difficulty: row.difficulty ?? "pendiente",
    imageAlt: `Imagen de ${row.title}`,
    imageUrl: row.image_url ?? undefined,
    instructions: row.instructions ?? undefined,
    manualUrl: row.manual_url ?? undefined,
  };
}

