import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { adminWeekColumns, validateWeekPayload } from "@/lib/admin/weeks";
import type { WeekRow } from "@/types/supabase";

type RouteContext = {
  params: Promise<{
    weekId: string;
  }>;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function mapWeekWriteError(message: string, code?: string) {
  if (code === "23505" || message.toLowerCase().includes("duplicate")) {
    return "Ya existe una semana con ese número en esta temporada.";
  }

  return "No se pudo actualizar la semana.";
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

  const { data, error } = await auth.supabase
    .from("weeks")
    .update(validated.data)
    .eq("id", weekId)
    .select(adminWeekColumns)
    .maybeSingle<WeekRow>();

  if (error) {
    return jsonError(mapWeekWriteError(error.message, error.code), 500);
  }

  if (!data) {
    return jsonError("Semana no encontrada.", 404);
  }

  return NextResponse.json({ ok: true, week: data });
}
