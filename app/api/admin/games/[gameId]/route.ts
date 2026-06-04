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

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const { gameId } = await params;
  const { count, error: countError } = await auth.supabase
    .from("weeks")
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId);

  if (countError) {
    return jsonError("No se pudo comprobar si el juego está en uso.", 500);
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        ok: false,
        code: "GAME_IN_USE",
        error: "No se puede borrar un juego usado por una semana.",
      },
      { status: 409 },
    );
  }

  const { error } = await auth.supabase.from("games").delete().eq("id", gameId);

  if (error) {
    return jsonError("No se pudo borrar el juego.", 500);
  }

  return NextResponse.json({ ok: true });
}
