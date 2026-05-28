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
    return jsonError(`No se pudo leer el calendario: ${readError.message}`, 500);
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
  const weekDiagnostics = {
    checked: 0,
    updated: 0,
    activated: 0,
    frozen: 0,
    published: 0,
    skipped: 0,
    unchanged: 0,
    errors: [] as Array<{ id: string; reason: string }>,
    skippedDetails: [] as Array<{ id: string; reason: string }>,
  };

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
    weekDiagnostics.checked += 1;

    if (!week.public_start_at || !week.final_deadline_at) {
      weekDiagnostics.skipped += 1;
      weekDiagnostics.skippedDetails.push({
        id: week.id,
        reason: "missing_public_start_at_or_final_deadline_at",
      });
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
          weekDiagnostics.updated += 1;
          weekDiagnostics.published += 1;
          weekChanges.push({
            id: week.id,
            weekNumber: week.week_number,
            previousStatus: week.status,
            nextStatus: "published",
            generatedResults: false,
          });
        }
      } else {
        weekDiagnostics.skipped += 1;
        weekDiagnostics.skippedDetails.push({
          id: week.id,
          reason: "already_published",
        });
      }

      continue;
    }

    const nextStatus = getSynchronizedWeekStatus(week, now, false);

    if (nextStatus === "closed") {
      const calculation = await calculateWeeklyResultsForWeek(supabase, week.id);

      if (!calculation.ok) {
        if (
          calculation.status === 409 &&
          calculation.error === "No hay miembros elegibles para esta semana."
        ) {
          const { error } = await supabase
            .from("weeks")
            .update({ status: "published" })
            .eq("id", week.id);

          if (error) {
            weekDiagnostics.errors.push({
              id: week.id,
              reason: error.message,
            });
          } else {
            weekDiagnostics.updated += 1;
            weekDiagnostics.published += 1;
          }

          weekChanges.push({
            id: week.id,
            weekNumber: week.week_number,
            previousStatus: week.status,
            nextStatus: error ? week.status : "published",
            generatedResults: false,
            error: error?.message,
          });
          continue;
        }

        const { error } = await supabase
          .from("weeks")
          .update({ status: "closed" })
          .eq("id", week.id);

        weekDiagnostics.errors.push({
          id: week.id,
          reason: calculation.error,
        });
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
        weekDiagnostics.errors.push({
          id: week.id,
          reason: writeResult.error,
        });
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
      if (error) {
        weekDiagnostics.errors.push({
          id: week.id,
          reason: error.message,
        });
      } else {
        weekDiagnostics.updated += 1;
        weekDiagnostics.published += 1;
      }
      continue;
    }

    if (nextStatus === week.status) {
      weekDiagnostics.unchanged += 1;
      continue;
    }

    const { error } = await supabase
      .from("weeks")
      .update({ status: nextStatus })
      .eq("id", week.id);

    if (!error) {
      weekDiagnostics.updated += 1;
      if (nextStatus === "active") {
        weekDiagnostics.activated += 1;
      }
      if (nextStatus === "frozen") {
        weekDiagnostics.frozen += 1;
      }
      weekChanges.push({
        id: week.id,
        weekNumber: week.week_number,
        previousStatus: week.status,
        nextStatus,
        generatedResults: false,
      });
    } else {
      weekDiagnostics.errors.push({
        id: week.id,
        reason: error.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processedAt: now.toISOString(),
    seasons: seasonChanges,
    weeks: {
      ...weekDiagnostics,
      changes: weekChanges,
    },
  });
}
