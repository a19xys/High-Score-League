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
    ? "Esta semana se solapa con otra semana de la misma temporada. En una tarea posterior se añadirá la opción de retrasar semanas posteriores."
    : null;
}

async function validateWithinSeason(
  data: {
    public_start_at: string | null;
    public_freeze_at: string | null;
    final_deadline_at: string | null;
  },
  season: { starts_at: string | null; ends_at: string | null },
) {
  if (!season.starts_at || !season.ends_at) {
    return null;
  }

  if (!data.public_start_at || !data.final_deadline_at) {
    return null;
  }

  const seasonStartsAt = new Date(season.starts_at).getTime();
  const seasonEndsAt = new Date(season.ends_at).getTime();
  const startsAt = new Date(data.public_start_at).getTime();
  const endsAt = new Date(data.final_deadline_at).getTime();
  const freezeAt = data.public_freeze_at
    ? new Date(data.public_freeze_at).getTime()
    : null;

  if (
    startsAt < seasonStartsAt ||
    endsAt > seasonEndsAt ||
    (freezeAt !== null && (freezeAt < startsAt || freezeAt > endsAt))
  ) {
    return "La semana debe estar dentro de las fechas de la temporada.";
  }

  return null;
}

async function getNextWeekNumber(supabase: SupabaseClient, seasonId: string) {
  const { data, error } = await supabase
    .from("weeks")
    .select("week_number")
    .eq("season_id", seasonId)
    .order("week_number", { ascending: false })
    .limit(1);

  if (error) {
    return { ok: false as const, error: "No se pudo calcular el número de semana." };
  }

  return {
    ok: true as const,
    value: (((data ?? [])[0] as { week_number: number } | undefined)
      ?.week_number ?? 0) + 1,
  };
}

async function renumberWeeksInSeason(
  supabase: SupabaseClient,
  seasonId: string,
) {
  const { data, error } = await supabase
    .from("weeks")
    .select("id,week_number,public_start_at,final_deadline_at,created_at")
    .eq("season_id", seasonId);

  if (error) {
    return { ok: false as const, error: "No se pudieron leer semanas para renumerar." };
  }

  const weeks = ((data ?? []) as Array<{
    id: string;
    week_number: number;
    public_start_at: string | null;
    final_deadline_at: string | null;
    created_at?: string;
  }>).sort((a, b) => {
    const aDate = a.public_start_at ?? a.final_deadline_at ?? a.created_at ?? "";
    const bDate = b.public_start_at ?? b.final_deadline_at ?? b.created_at ?? "";
    return aDate.localeCompare(bDate) || a.id.localeCompare(b.id);
  });

  const offset = 1_000_000;

  for (let index = 0; index < weeks.length; index += 1) {
    const { error: updateError } = await supabase
      .from("weeks")
      .update({ week_number: offset + index + 1 })
      .eq("id", weeks[index].id);

    if (updateError) {
      return { ok: false as const, error: "No se pudo preparar la renumeración de semanas." };
    }
  }

  for (let index = 0; index < weeks.length; index += 1) {
    const nextNumber = index + 1;

    const { error: updateError } = await supabase
      .from("weeks")
      .update({ week_number: nextNumber })
      .eq("id", weeks[index].id);

    if (updateError) {
      return { ok: false as const, error: "No se pudo renumerar semanas." };
    }
  }

  return { ok: true as const };
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

  const seasonRangeError = await validateWithinSeason(
    validated.data,
    targetSeasonCheck.season,
  );

  if (seasonRangeError) {
    return jsonError(seasonRangeError, 409);
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

  const { data: existingWeek, error: existingWeekError } = await auth.supabase
    .from("weeks")
    .select("id,season_id,week_number")
    .eq("id", weekId)
    .maybeSingle<Pick<WeekRow, "id" | "season_id" | "week_number">>();

  if (existingWeekError) {
    return jsonError("No se pudo comprobar la semana existente.", 500);
  }

  if (!existingWeek) {
    return jsonError("Semana no encontrada.", 404);
  }

  let weekNumber = existingWeek.week_number;

  if (existingWeek.season_id !== validated.data.season_id) {
    const nextWeekNumber = await getNextWeekNumber(
      auth.supabase,
      validated.data.season_id,
    );

    if (!nextWeekNumber.ok) {
      return jsonError(nextWeekNumber.error, 500);
    }

    weekNumber = nextWeekNumber.value;
  }

  const { data, error } = await auth.supabase
    .from("weeks")
    .update({
      ...validated.data,
      week_number: weekNumber,
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

  const affectedSeasonIds = Array.from(
    new Set([existingWeek.season_id, validated.data.season_id]),
  );

  for (const seasonId of affectedSeasonIds) {
    const renumbering = await renumberWeeksInSeason(auth.supabase, seasonId);

    if (!renumbering.ok) {
      return jsonError(renumbering.error, 500);
    }
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
