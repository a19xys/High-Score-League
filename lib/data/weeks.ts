import { getDerivedWeekStatusFromRow } from "@/lib/week-status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Week } from "@/types";
import type { WeekRow } from "@/types/supabase";
import type { DataReadOptions, DataReadResult } from "./types";

const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";

function emptyResult(error: string | null): DataReadResult<WeekRow> {
  return {
    rows: [],
    source: "supabase",
    error,
  };
}

export function mapWeekRowToWeek(row: WeekRow): Week {
  return {
    id: row.id,
    seasonId: row.season_id,
    gameId: row.game_id,
    number: row.week_number,
    startsAt: row.public_start_at ?? "",
    endsAt: row.final_deadline_at ?? "",
    publicFreezeAt: row.public_freeze_at ?? undefined,
    revealAt: row.reveal_at ?? undefined,
    status: row.status,
    rules: row.rules_summary ? row.rules_summary.split("\n").filter(Boolean) : [],
  };
}

export async function getRealWeeks(
  _options: DataReadOptions = {},
): Promise<DataReadResult<WeekRow>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return emptyResult("Supabase no está configurado.");
  }

  const { data, error } = await supabase
    .from("weeks")
    .select(weekColumns)
    .order("public_start_at", { ascending: false, nullsFirst: false });

  if (error) {
    return emptyResult(error.message);
  }

  return {
    rows: (data ?? []) as WeekRow[],
    source: "supabase",
    error: null,
  };
}

export async function getCurrentRealWeek(
  options: DataReadOptions = {},
): Promise<WeekRow | null> {
  const result = await getRealWeeks(options);
  return (
    result.rows.find((week) => {
      const status = getDerivedWeekStatusFromRow(week);
      return status === "active" || status === "final_stretch";
    }) ?? null
  );
}

export async function getRealWeekById(
  weekId: string,
  options: DataReadOptions = {},
): Promise<DataReadResult<WeekRow>> {
  const weeks = await getRealWeeks(options);
  return {
    ...weeks,
    rows: weeks.rows.filter((week) => week.id === weekId),
  };
}

