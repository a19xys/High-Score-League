import { type NextRequest, NextResponse } from "next/server";
import { validateSeasonPayload, adminSeasonColumns } from "@/lib/admin/seasons";
import { requireAdmin } from "@/lib/auth/admin";
import type { SeasonRow } from "@/types/supabase";

type RouteContext = {
  params: Promise<{
    seasonId: string;
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

  const { seasonId } = await params;
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

  const { data, error } = await auth.supabase
    .from("seasons")
    .update(validated.data)
    .eq("id", seasonId)
    .select(adminSeasonColumns)
    .maybeSingle<SeasonRow>();

  if (error) {
    return jsonError("No se pudo actualizar la temporada.", 500);
  }

  if (!data) {
    return jsonError("Temporada no encontrada.", 404);
  }

  return NextResponse.json({ ok: true, season: data });
}
