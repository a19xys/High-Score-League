import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Game } from "@/types";
import type { GameRow } from "@/types/supabase";
import type { DataReadOptions, DataReadResult } from "./types";

const gameColumns =
  "id,title,year,developers,publishers,perspectives,themes,genres,rom_name,image_url,header_image_url,logo_image_url,accent_color_primary,accent_color_secondary,instructions,manual_url,download_url,notes,created_at,updated_at";

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
  const developers = row.developers ?? [];
  const publishers = row.publishers ?? [];
  const perspectives = row.perspectives ?? [];
  const themes = row.themes ?? [];
  const genres = row.genres ?? [];
  const taxonomyTags = [...genres, ...themes, ...perspectives];

  return {
    id: row.id,
    title: row.title,
    slug: row.rom_name ?? row.title.toLowerCase().replaceAll(" ", "-"),
    year: row.year ?? undefined,
    developers,
    publishers,
    perspectives,
    themes,
    genres,
    taxonomyTags,
    developer: developers.length > 0 ? developers.join(" · ") : "Desconocido",
    publisher: publishers.length > 0 ? publishers.join(" · ") : "Sin editor",
    genre: taxonomyTags.length > 0 ? taxonomyTags.join(" · ") : "Arcade",
    imageAlt: `Imagen de ${row.title}`,
    imageUrl: row.image_url ?? undefined,
    headerImageUrl: row.header_image_url ?? undefined,
    logoImageUrl: row.logo_image_url ?? undefined,
    accentColorPrimary: row.accent_color_primary ?? null,
    accentColorSecondary: row.accent_color_secondary ?? null,
    instructions: row.instructions ?? undefined,
    manualUrl: row.manual_url ?? undefined,
    downloadUrl: row.download_url ?? null,
  };
}

