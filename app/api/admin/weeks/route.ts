import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { adminWeekColumns, validateWeekPayload } from "@/lib/admin/weeks";
import type { WeekRow } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
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
    status: WeekRow["status"];
    public_start_at: string | null;
    final_deadline_at: string | null;
  },
  excludeWeekId?: string,
) {
  if (data.status === "active") {
    let query = supabase.from("weeks").select("id").eq("status", "active").limit(1);

    if (excludeWeekId) {
      query = query.neq("id", excludeWeekId);
    }

    const { data: activeWeek, error } = await query.maybeSingle<{ id: string }>();

    if (error) {
      return "No se pudo validar si ya existe otra semana activa.";
    }

    if (activeWeek) {
      return "Ya existe otra semana marcada como active.";
    }
  }

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
    ? `Las fechas se solapan con la semana ${overlapping.week_number} de esta temporada.`
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

  const scheduleError = await validateSchedule(auth.supabase, validated.data);

  if (scheduleError) {
    return jsonError(scheduleError, 409);
  }

  const { data, error } = await auth.supabase
    .from("weeks")
    .insert(validated.data)
    .select(adminWeekColumns)
    .single<WeekRow>();

  if (error) {
    return jsonError(mapWeekWriteError(error.message, error.code), 500);
  }

  return NextResponse.json({ ok: true, week: data });
}
