import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { adminGameColumns, validateGamePayload } from "@/lib/admin/games";
import type { GameRow } from "@/types/supabase";

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

  const validated = validateGamePayload(payload as Record<string, unknown>);

  if (!validated.ok) {
    return jsonError(validated.error);
  }

  const { data, error } = await auth.supabase
    .from("games")
    .insert(validated.data)
    .select(adminGameColumns)
    .single<GameRow>();

  if (error) {
    return jsonError("No se pudo crear el juego.", 500);
  }

  return NextResponse.json({ ok: true, game: data });
}
