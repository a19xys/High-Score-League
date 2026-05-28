import { weeks as mockWeeks } from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Week } from "@/types";
import type { WeekRow } from "@/types/supabase";
import { getDerivedWeekStatusFromRow } from "@/lib/week-status";
import type { DataReadOptions, DataReadResult } from "./types";

const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";

function mockWeekRows(): WeekRow[] {
  return mockWeeks.map((week) => ({
    id: week.id,
    season_id: week.seasonId,
    game_id: week.gameId,
    week_number: week.number,
    status: week.status,
    public_start_at: week.startsAt,
    public_freeze_at: null,
    final_deadline_at: week.endsAt,
    reveal_at: week.revealAt ?? null,
    rules_summary: week.rules.join("\n"),
    created_at: undefined,
    updated_at: undefined,
  }));
}

function fallbackResult(error: string | null): DataReadResult<WeekRow> {
  return {
    rows: mockWeekRows(),
    source: "mock",
    error,
    usingFallback: true,
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
    revealAt: row.reveal_at ?? undefined,
    status: row.status,
    rules: row.rules_summary
      ? row.rules_summary.split("\n").filter(Boolean)
      : ["Reglas pendientes."],
  };
}

export async function getRealWeeks(
  options: DataReadOptions = {},
): Promise<DataReadResult<WeekRow>> {
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
    .from("weeks")
    .select(weekColumns)
    .order("public_start_at", { ascending: false, nullsFirst: false });

  if (error) {
    return options.fallbackToMock
      ? fallbackResult(error.message)
      : { rows: [], source: "supabase", error: error.message, usingFallback: false };
  }

  return {
    rows: (data ?? []) as WeekRow[],
    source: "supabase",
    error: null,
    usingFallback: false,
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
