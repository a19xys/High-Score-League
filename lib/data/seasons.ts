import { seasons as mockSeasons } from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Season } from "@/types";
import type { SeasonRow } from "@/types/supabase";
import type { DataReadOptions, DataReadResult } from "./types";

const seasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";

function mockSeasonRows(): SeasonRow[] {
  return mockSeasons.map((season) => ({
    id: season.id,
    name: season.name,
    slug: season.slug,
    version: season.version ?? null,
    status: season.status,
    starts_at: season.startsAt,
    ends_at: season.endsAt,
    created_at: undefined,
    updated_at: undefined,
  }));
}

function fallbackResult(error: string | null): DataReadResult<SeasonRow> {
  return {
    rows: mockSeasonRows(),
    source: "mock",
    error,
    usingFallback: true,
  };
}

export function mapSeasonRowToSeason(row: SeasonRow, weekCount = 0): Season {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version ?? undefined,
    status: row.status,
    startsAt: row.starts_at ?? "",
    endsAt: row.ends_at ?? "",
    weekCount,
  };
}

export async function getRealSeasons(
  options: DataReadOptions = {},
): Promise<DataReadResult<SeasonRow>> {
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
    .from("seasons")
    .select(seasonColumns)
    .order("starts_at", { ascending: false, nullsFirst: false });

  if (error) {
    return options.fallbackToMock
      ? fallbackResult(error.message)
      : { rows: [], source: "supabase", error: error.message, usingFallback: false };
  }

  return {
    rows: (data ?? []) as SeasonRow[],
    source: "supabase",
    error: null,
    usingFallback: false,
  };
}

export async function getRealSeasonById(
  seasonId: string,
  options: DataReadOptions = {},
): Promise<DataReadResult<SeasonRow>> {
  const seasons = await getRealSeasons(options);
  return {
    ...seasons,
    rows: seasons.rows.filter((season) => season.id === seasonId),
  };
}

export async function getActiveRealSeason(
  options: DataReadOptions = {},
): Promise<SeasonRow | null> {
  const result = await getRealSeasons(options);
  return result.rows.find((season) => season.status === "active") ?? null;
}
