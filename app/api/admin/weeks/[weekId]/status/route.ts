import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
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

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { weekId } = await params;
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
