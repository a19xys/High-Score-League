import { type NextRequest, NextResponse } from "next/server";
import { validateSeasonPayload, adminSeasonColumns } from "@/lib/admin/seasons";
import { requireAdmin } from "@/lib/auth/admin";
import type { SeasonRow } from "@/types/supabase";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
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
