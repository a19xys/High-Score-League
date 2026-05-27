import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { adminGameColumns, validateGamePayload } from "@/lib/admin/games";
import type { GameRow } from "@/types/supabase";

type RouteContext = {
  params: Promise<{
    gameId: string;
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

  const { gameId } = await params;
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
    .update(validated.data)
    .eq("id", gameId)
    .select(adminGameColumns)
    .maybeSingle<GameRow>();

  if (error) {
    return jsonError("No se pudo actualizar el juego.", 500);
  }

  if (!data) {
    return jsonError("Juego no encontrado.", 404);
  }

  return NextResponse.json({ ok: true, game: data });
}
