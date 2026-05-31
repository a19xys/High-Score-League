import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { adminWeekColumns, validateWeekPayload } from "@/lib/admin/weeks";
import {
  assertSeasonCanReceiveWeekChanges,
  assertWeekSeasonCanBeChanged,
  reconcileWeek,
} from "@/lib/admin/reconcile-week";
import { getSynchronizedWeekStatus } from "@/lib/week-status";
import type { WeekRow } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

type RouteContext = {
  params: Promise<{
    weekId: string;
  }>;
};

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

  return "No se pudo actualizar la semana.";
}

async function validateSchedule(
  supabase: SupabaseClient,
  data: {
    season_id: string;
    public_start_at: string | null;
    final_deadline_at: string | null;
  },
  excludeWeekId: string,
) {
  if (!data.public_start_at || !data.final_deadline_at) {
    return null;
  }

  const { data: weeks, error } = await supabase
    .from("weeks")
    .select("id,week_number,public_start_at,final_deadline_at")
    .eq("season_id", data.season_id)
    .neq("id", excludeWeekId)
    .not("public_start_at", "is", null)
    .not("final_deadline_at", "is", null);

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
    ? `Las fechas se solapan con la semana ${overlapping.week_number} de esta temporada.`
    : null;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { weekId } = await params;
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

  const existingSeasonCheck = await assertWeekSeasonCanBeChanged(
    auth.supabase,
    weekId,
  );

  if (!existingSeasonCheck.ok) {
    return jsonCodeError(
      existingSeasonCheck.code,
      existingSeasonCheck.error,
      existingSeasonCheck.status,
    );
  }

  const targetSeasonCheck = await assertSeasonCanReceiveWeekChanges(
    auth.supabase,
    validated.data.season_id,
  );

  if (!targetSeasonCheck.ok) {
    return jsonCodeError(
      targetSeasonCheck.code,
      targetSeasonCheck.error,
      targetSeasonCheck.status,
    );
  }

  const scheduleError = await validateSchedule(
    auth.supabase,
    validated.data,
    weekId,
  );

  if (scheduleError) {
    return jsonError(scheduleError, 409);
  }

  const { data: existingResults, error: resultsError } = await auth.supabase
    .from("weekly_results")
    .select("id")
    .eq("week_id", weekId)
    .limit(1);

  if (resultsError) {
    return jsonError("No se pudo comprobar si hay resultados oficiales.", 500);
  }

  const { data, error } = await auth.supabase
    .from("weeks")
    .update({
      ...validated.data,
      status: getSynchronizedWeekStatus(
        {
          status: "draft",
          public_start_at: validated.data.public_start_at,
          public_freeze_at: validated.data.public_freeze_at,
          final_deadline_at: validated.data.final_deadline_at,
        },
        new Date(),
        (existingResults ?? []).length > 0,
      ),
    })
    .eq("id", weekId)
    .select(adminWeekColumns)
    .maybeSingle<WeekRow>();

  if (error) {
    return jsonError(mapWeekWriteError(error.message, error.code), 500);
  }

  if (!data) {
    return jsonError("Semana no encontrada.", 404);
  }

  const reconciliation = await reconcileWeek(auth.supabase, data.id);

  if (!reconciliation.ok) {
    return jsonError(reconciliation.error, reconciliation.status);
  }

  return NextResponse.json({
    ok: true,
    week: reconciliation.week,
    reconciliation: reconciliation.summary,
  });
}
