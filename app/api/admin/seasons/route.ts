import { type NextRequest, NextResponse } from "next/server";
import { validateSeasonPayload, adminSeasonColumns } from "@/lib/admin/seasons";
import { requireAdmin } from "@/lib/auth/admin";
import type { SeasonRow } from "@/types/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function validateSeasonSchedule(
  supabase: SupabaseClient,
  data: {
    status: SeasonRow["status"];
    starts_at: string | null;
    ends_at: string | null;
  },
  excludeSeasonId?: string,
) {
  if (data.status === "active") {
    let query = supabase.from("seasons").select("id").eq("status", "active").limit(1);

    if (excludeSeasonId) {
      query = query.neq("id", excludeSeasonId);
    }

    const { data: activeSeason, error } = await query.maybeSingle<{ id: string }>();

    if (error) {
      return "No se pudo validar si ya existe otra temporada activa.";
    }

    if (activeSeason) {
      return "Ya existe otra temporada marcada como active.";
    }
  }

  if (!data.starts_at || !data.ends_at) {
    return null;
  }

  let query = supabase
    .from("seasons")
    .select("id,name,starts_at,ends_at")
    .not("starts_at", "is", null)
    .not("ends_at", "is", null);

  if (excludeSeasonId) {
    query = query.neq("id", excludeSeasonId);
  }

  const { data: seasons, error } = await query;

  if (error) {
    return "No se pudo validar solape de fechas con otras temporadas.";
  }

  const startsAt = new Date(data.starts_at).getTime();
  const endsAt = new Date(data.ends_at).getTime();
  const overlapping = ((seasons ?? []) as Array<{
    name: string;
    starts_at: string;
    ends_at: string;
  }>).find((season) => {
    const otherStartsAt = new Date(season.starts_at).getTime();
    const otherEndsAt = new Date(season.ends_at).getTime();

    return startsAt < otherEndsAt && otherStartsAt < endsAt;
  });

  return overlapping
    ? `Las fechas se solapan con la temporada ${overlapping.name}.`
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

  const validated = validateSeasonPayload(payload as Record<string, unknown>);

  if (!validated.ok) {
    return jsonError(validated.error);
  }

  const scheduleError = await validateSeasonSchedule(auth.supabase, validated.data);

  if (scheduleError) {
    return jsonError(scheduleError, 409);
  }

  const { data, error } = await auth.supabase
    .from("seasons")
    .insert(validated.data)
    .select(adminSeasonColumns)
    .single<SeasonRow>();

  if (error) {
    return jsonError("No se pudo crear la temporada.", 500);
  }

  return NextResponse.json({ ok: true, season: data });
}
