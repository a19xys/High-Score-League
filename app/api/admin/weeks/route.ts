import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { adminWeekColumns, validateWeekPayload } from "@/lib/admin/weeks";
import {
  assertSeasonCanReceiveWeekChanges,
  reconcileWeek,
} from "@/lib/admin/reconcile-week";
import {
  getNextWeekNumber,
  renumberWeeksInSeason,
  resolveWeekOverlaps,
  validateWeekWithinSeason,
} from "@/lib/admin/week-calendar";
import { getSynchronizedWeekStatus } from "@/lib/week-status";
import type { WeekRow } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function jsonCodeError(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function mapWeekWriteError(message: string, code?: string) {
  if (code === "23505" || message.toLowerCase().includes("duplicate")) {
    return "Ya existe una semana con ese número en esta temporada.";
  }

  return "No se pudo crear la semana.";
}

async function validateSchedule(
  supabase: SupabaseClient,
  data: {
    season_id: string;
    public_start_at: string | null;
    final_deadline_at: string | null;
  },
  excludeWeekId?: string,
) {
  if (!data.public_start_at || !data.final_deadline_at) {
    return null;
  }

  let query = supabase
    .from("weeks")
    .select("id,week_number,public_start_at,final_deadline_at")
    .eq("season_id", data.season_id)
    .not("public_start_at", "is", null)
    .not("final_deadline_at", "is", null);

  if (excludeWeekId) {
    query = query.neq("id", excludeWeekId);
  }

  const { data: weeks, error } = await query;

  if (error) {
    return "No se pudo validar solape de fechas con otras semanas.";
  }

  const startsAt = new Date(data.public_start_at).getTime();
  const endsAt = new Date(data.final_deadline_at).getTime();
  const overlapping = ((weeks ?? []) as Array<{
    week_number: number;
    public_start_at: string;
    final_deadline_at: string;
  }>).find((week) => {
    const otherStartsAt = new Date(week.public_start_at).getTime();
    const otherEndsAt = new Date(week.final_deadline_at).getTime();

    return startsAt < otherEndsAt && otherStartsAt < endsAt;
  });

  return overlapping
    ? "Esta semana se solapa con otra semana de la misma temporada. En una tarea posterior se añadirá la opción de retrasar semanas posteriores."
    : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("Payload JSON inválido.");
  }

  const validated = validateWeekPayload(payload as Record<string, unknown>);

  if (!validated.ok) {
    return jsonError(validated.error);
  }

  const seasonCheck = await assertSeasonCanReceiveWeekChanges(
    auth.supabase,
    validated.data.season_id,
  );

  if (!seasonCheck.ok) {
    return jsonCodeError(seasonCheck.code, seasonCheck.error, seasonCheck.status);
  }

  const seasonRangeError = await validateWeekWithinSeason(
    validated.data,
    seasonCheck.season,
  );

  if (seasonRangeError) {
    return jsonError(seasonRangeError, 409);
  }

  const { shift_following_weeks: shiftFollowingWeeks, ...weekData } =
    validated.data;
  const overlapResolution = await resolveWeekOverlaps(
    auth.supabase,
    weekData,
    seasonCheck.season,
    shiftFollowingWeeks,
  );

  if (!overlapResolution.ok) {
    return jsonError(overlapResolution.error, overlapResolution.status);
  }

  const nextWeekNumber = await getNextWeekNumber(
    auth.supabase,
    validated.data.season_id,
  );

  if (!nextWeekNumber.ok) {
    return jsonError(nextWeekNumber.error, 500);
  }

  const { data, error } = await auth.supabase
    .from("weeks")
    .insert({
      ...weekData,
      week_number: nextWeekNumber.value,
      status: getSynchronizedWeekStatus({
        status: "draft",
        public_start_at: weekData.public_start_at,
        public_freeze_at: weekData.public_freeze_at,
        final_deadline_at: weekData.final_deadline_at,
      }),
    })
    .select(adminWeekColumns)
    .single<WeekRow>();

  if (error) {
    return jsonError(mapWeekWriteError(error.message, error.code), 500);
  }

  const renumbering = await renumberWeeksInSeason(
    auth.supabase,
    weekData.season_id,
  );

  if (!renumbering.ok) {
    return jsonError(renumbering.error, 500);
  }

  const reconciliation = await reconcileWeek(auth.supabase, data.id);

  if (!reconciliation.ok) {
    return jsonError(reconciliation.error, reconciliation.status);
  }

  for (const shiftedWeek of overlapResolution.shiftedWeeks) {
    const shiftedReconciliation = await reconcileWeek(
      auth.supabase,
      shiftedWeek.id,
    );

    if (!shiftedReconciliation.ok) {
      return jsonError(shiftedReconciliation.error, shiftedReconciliation.status);
    }
  }

  return NextResponse.json({
    ok: true,
    week: reconciliation.week,
    reconciliation: reconciliation.summary,
    shiftedWeeks: overlapResolution.shiftedWeeks,
  });
}
