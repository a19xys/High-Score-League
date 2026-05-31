import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assertWeekSeasonCanBeChanged } from "@/lib/admin/reconcile-week";
import type { WeekStatus } from "@/types";

type RouteContext = {
  params: Promise<{
    weekId: string;
  }>;
};

const allowedStatuses = new Set<WeekStatus>([
  "draft",
  "active",
  "frozen",
  "closed",
  "published",
]);

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

  const { weekId } = await params;
  const seasonCheck = await assertWeekSeasonCanBeChanged(auth.supabase, weekId);

  if (!seasonCheck.ok) {
    return jsonCodeError(seasonCheck.code, seasonCheck.error, seasonCheck.status);
  }

  let payload: { status?: unknown };

  try {
    payload = (await request.json()) as { status?: unknown };
  } catch {
    return jsonError("Payload JSON inválido.");
  }

  if (typeof payload.status !== "string") {
    return jsonError("status es obligatorio.");
  }

  if (!allowedStatuses.has(payload.status as WeekStatus)) {
    return jsonError("Estado de semana no permitido.");
  }

  const { data, error } = await auth.supabase
    .from("weeks")
    .update({ status: payload.status })
    .eq("id", weekId)
    .select("id,status")
    .maybeSingle<{ id: string; status: WeekStatus }>();

  if (error) {
    return jsonError("No se pudo actualizar el estado de la semana.", 500);
  }

  if (!data) {
    return jsonError("Semana no encontrada.", 404);
  }

  return NextResponse.json({ ok: true, week: data });
}
