import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import {
  adminBenchmarkColumns,
  validateBenchmarkPayload,
} from "@/lib/admin/weeks";
import type { WeekBenchmarkRow } from "@/types/supabase";

type RouteContext = {
  params: Promise<{
    weekId: string;
    benchmarkId: string;
  }>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { weekId, benchmarkId } = await params;
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
