import { type NextRequest, NextResponse } from "next/server";
import { votePublicHomePoll } from "@/lib/data/home-poll";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function jsonError(error: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas iniciar sesión.", 401);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("Payload JSON inválido.");
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return jsonError("Payload JSON inválido.");
  }

  if ("playerId" in payload) {
    return jsonError("playerId no se acepta desde cliente.", 400, "PLAYER_ID_NOT_ALLOWED");
  }

  const optionId =
    "optionId" in payload && typeof payload.optionId === "string"
      ? payload.optionId
      : "";

  if (!optionId || !isUuid(optionId)) {
    return jsonError("Elige una opción válida.");
  }

  const result = await votePublicHomePoll(supabase, userData.user.id, optionId);

  if (!result.ok) {
    return jsonError(result.error ?? "No se pudo registrar tu voto.", result.status);
  }

  return NextResponse.json({ ok: true, poll: result.poll });
}
