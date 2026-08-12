import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assertWeekSeasonCanBeChanged } from "@/lib/admin/reconcile-week";
import {
  adminBenchmarkColumns,
  validateBenchmarkPayload,
} from "@/lib/admin/weeks";
import type { WeekBenchmarkRow } from "@/types/supabase";
import { deleteManagedMedia } from "@/lib/media/storage";

type RouteContext = {
  params: Promise<{
    weekId: string;
    benchmarkId: string;
  }>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function jsonCodeError(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { weekId, benchmarkId } = await params;
  const seasonCheck = await assertWeekSeasonCanBeChanged(auth.supabase, weekId);

  if (!seasonCheck.ok) {
    return jsonCodeError(seasonCheck.code, seasonCheck.error, seasonCheck.status);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("Payload JSON inválido.");
  }

  const validated = validateBenchmarkPayload(payload as Record<string, unknown>);

  if (!validated.ok) {
    return jsonError(validated.error);
  }

  const { data, error } = await auth.supabase
    .from("week_benchmarks")
    .update(validated.data)
    .eq("id", benchmarkId)
    .eq("week_id", weekId)
    .select(adminBenchmarkColumns)
    .maybeSingle<WeekBenchmarkRow>();

  if (error) {
    return jsonError("No se pudo actualizar el benchmark.", 500);
  }

  if (!data) {
    return jsonError("Benchmark no encontrado.", 404);
  }

  return NextResponse.json({ ok: true, benchmark: data });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { weekId, benchmarkId } = await params;
  const seasonCheck = await assertWeekSeasonCanBeChanged(auth.supabase, weekId);

  if (!seasonCheck.ok) {
    return jsonCodeError(seasonCheck.code, seasonCheck.error, seasonCheck.status);
  }

  const current = await auth.supabase
    .from("week_benchmarks")
    .select("id,image_storage_path")
    .eq("id", benchmarkId)
    .eq("week_id", weekId)
    .maybeSingle<{ id: string; image_storage_path: string | null }>();

  if (current.error) {
    return jsonError("No se pudo leer el benchmark antes de eliminarlo.", 500);
  }

  if (!current.data) {
    return jsonError("Benchmark no encontrado.", 404);
  }

  const deleted = await auth.supabase
    .from("week_benchmarks")
    .delete()
    .eq("id", benchmarkId)
    .eq("week_id", weekId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (deleted.error) {
    return jsonError("No se pudo eliminar el benchmark.", 500);
  }

  if (!deleted.data) {
    return jsonError("El benchmark ya no existe; no se retiró ninguna imagen.", 409);
  }

  const cleanupWarning = await deleteManagedMedia(auth.supabase, [
    current.data.image_storage_path,
  ]);

  return NextResponse.json({
    ok: true,
    deletedBenchmarkId: benchmarkId,
    cleanupWarning,
  });
}
