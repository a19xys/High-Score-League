import { games as mockGames } from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Game } from "@/types";
import type { GameRow } from "@/types/supabase";
import type { DataReadOptions, DataReadResult } from "./types";

const gameColumns =
  "id,title,year,developer,publisher,rom_name,genre,control_type,difficulty,image_url,instructions,manual_url,notes,created_at,updated_at";

function mockGameRows(): GameRow[] {
  return mockGames.map((game) => ({
    id: game.id,
    title: game.title,
    year: null,
    developer: game.developer,
    publisher: null,
    rom_name: game.slug,
    genre: game.genre,
    control_type: game.controlType,
    difficulty: game.difficulty,
    image_url: game.imageUrl ?? null,
    instructions: null,
    manual_url: game.manualUrl ?? null,
    notes: `${game.genre} · ${game.controlType} · dificultad ${game.difficulty}`,
    created_at: undefined,
    updated_at: undefined,
  }));
}

function fallbackResult(error: string | null): DataReadResult<GameRow> {
  return {
    rows: mockGameRows(),
    source: "mock",
    error,
    usingFallback: true,
  };
}

export async function getRealGames(
  options: DataReadOptions = {},
): Promise<DataReadResult<GameRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return options.fallbackToMock
      ? fallbackResult("Supabase no esta configurado.")
      : {
          rows: [],
          source: "supabase",
          error: "Supabase no esta configurado.",
          usingFallback: false,
        };
  }

  const { data, error } = await supabase
    .from("games")
    .select(gameColumns)
    .order("title", { ascending: true });

  if (error) {
    return options.fallbackToMock
      ? fallbackResult(error.message)
      : { rows: [], source: "supabase", error: error.message, usingFallback: false };
  }

  return {
    rows: (data ?? []) as GameRow[],
    source: "supabase",
    error: null,
    usingFallback: false,
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
