import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  calculateWeeklyResultsForWeek,
  replaceWeeklyResultsForWeek,
} from "@/lib/weekly-results/calculate";
import {
  getSynchronizedSeasonStatus,
  getSynchronizedWeekStatus,
} from "@/lib/week-status";
import type { SeasonRow, WeekRow } from "@/types/supabase";

const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";
const seasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return jsonError("No autorizado.", 401);
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return jsonError(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en servidor.",
      500,
    );
  }

  const now = new Date();
  const [weeksResult, seasonsResult, weeklyResultsResult] = await Promise.all([
    supabase.from("weeks").select(weekColumns),
    supabase.from("seasons").select(seasonColumns),
    supabase.from("weekly_results").select("id,week_id"),
  ]);

  const readError =
    weeksResult.error ?? seasonsResult.error ?? weeklyResultsResult.error;

  if (readError) {
    return jsonError("No se pudo leer el calendario.", 500);
  }

  const resultWeekIds = new Set(
    ((weeklyResultsResult.data ?? []) as Array<{ week_id: string }>).map(
      (result) => result.week_id,
    ),
  );
  const seasonChanges: Array<{
    id: string;
    name: string;
    previousStatus: SeasonRow["status"];
    nextStatus: SeasonRow["status"];
  }> = [];
  const weekChanges: Array<{
    id: string;
    weekNumber: number;
    previousStatus: WeekRow["status"];
    nextStatus: WeekRow["status"];
    generatedResults: boolean;
    error?: string;
  }> = [];

  for (const season of (seasonsResult.data ?? []) as SeasonRow[]) {
    if (!season.starts_at || !season.ends_at) {
      continue;
    }

    const nextStatus = getSynchronizedSeasonStatus(season, now);

    if (nextStatus === season.status) {
      continue;
    }

    const { error } = await supabase
      .from("seasons")
      .update({ status: nextStatus })
      .eq("id", season.id);

    if (!error) {
      seasonChanges.push({
        id: season.id,
        name: season.name,
        previousStatus: season.status,
        nextStatus,
      });
    }
  }

  for (const week of (weeksResult.data ?? []) as WeekRow[]) {
    if (!week.public_start_at || !week.final_deadline_at) {
      continue;
    }

    const hasOfficialResults = resultWeekIds.has(week.id);

    if (week.status === "published" || hasOfficialResults) {
      if (week.status !== "published") {
        const { error } = await supabase
          .from("weeks")
          .update({ status: "published" })
          .eq("id", week.id);

        if (!error) {
          weekChanges.push({
            id: week.id,
            weekNumber: week.week_number,
            previousStatus: week.status,
            nextStatus: "published",
            generatedResults: false,
          });
        }
      }

      continue;
    }

    const nextStatus = getSynchronizedWeekStatus(week, now, false);

    if (nextStatus === "closed") {
      const calculation = await calculateWeeklyResultsForWeek(supabase, week.id);

      if (!calculation.ok) {
        const { error } = await supabase
          .from("weeks")
          .update({ status: "closed" })
          .eq("id", week.id);

        weekChanges.push({
          id: week.id,
          weekNumber: week.week_number,
          previousStatus: week.status,
          nextStatus: error ? week.status : "closed",
          generatedResults: false,
          error: calculation.error,
        });
        continue;
      }

      const writeResult = await replaceWeeklyResultsForWeek(
        supabase,
        week.id,
        calculation.results,
      );

      if (!writeResult.ok) {
        weekChanges.push({
          id: week.id,
          weekNumber: week.week_number,
          previousStatus: week.status,
          nextStatus: week.status,
          generatedResults: false,
          error: writeResult.error,
        });
        continue;
      }

      const { error } = await supabase
        .from("weeks")
        .update({ status: "published" })
        .eq("id", week.id);

      weekChanges.push({
        id: week.id,
        weekNumber: week.week_number,
        previousStatus: week.status,
        nextStatus: error ? week.status : "published",
        generatedResults: !error,
        error: error?.message,
      });
      continue;
    }

    if (nextStatus === week.status) {
      continue;
    }

    const { error } = await supabase
      .from("weeks")
      .update({ status: nextStatus })
      .eq("id", week.id);

    if (!error) {
      weekChanges.push({
        id: week.id,
        weekNumber: week.week_number,
        previousStatus: week.status,
        nextStatus,
        generatedResults: false,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processedAt: now.toISOString(),
    seasons: seasonChanges,
    weeks: weekChanges,
  });
}
