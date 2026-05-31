import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assertWeekSeasonCanBeChanged } from "@/lib/admin/reconcile-week";
import {
  adminBenchmarkColumns,
  validateBenchmarkPayload,
} from "@/lib/admin/weeks";
import type { WeekBenchmarkRow } from "@/types/supabase";

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

export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { weekId } = await params;
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
    .insert({ ...validated.data, week_id: weekId })
    .select(adminBenchmarkColumns)
    .single<WeekBenchmarkRow>();

  if (error) {
    return jsonError("No se pudo crear el benchmark.", 500);
  }

  return NextResponse.json({ ok: true, benchmark: data });
}
