import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSynchronizedSeasonStatus } from "@/lib/week-status";
import type { Season } from "@/types";
import type { SeasonRow } from "@/types/supabase";
import type { DataReadOptions, DataReadResult } from "./types";

const seasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";

function emptyResult(error: string | null): DataReadResult<SeasonRow> {
  return {
    rows: [],
    source: "supabase",
    error,
  };
}

export function mapSeasonRowToSeason(row: SeasonRow, weekCount = 0): Season {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version ?? undefined,
    status: getSynchronizedSeasonStatus(row),
    startsAt: row.starts_at ?? "",
    endsAt: row.ends_at ?? "",
    weekCount,
  };
}

export async function getRealSeasons(
  _options: DataReadOptions = {},
): Promise<DataReadResult<SeasonRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return emptyResult("Supabase no está configurado.");
  }

  const { data, error } = await supabase
    .from("seasons")
    .select(seasonColumns)
    .order("starts_at", { ascending: false, nullsFirst: false });

  if (error) {
    return emptyResult(error.message);
  }

  return {
    rows: (data ?? []) as SeasonRow[],
    source: "supabase",
    error: null,
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
  return (
    result.rows.find(
      (season) => getSynchronizedSeasonStatus(season) === "active",
    ) ?? null
  );
}

