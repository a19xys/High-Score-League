import { type NextRequest, NextResponse } from "next/server";
import { validatePlayTimePayload } from "@/lib/playtime-contract";
import { createCookieOrBearerAuthenticatedClient } from "@/lib/auth/request-client";
import { getVerifiedProductIdentity } from "@/lib/auth/session-context";
import { hasActiveProfile } from "@/lib/auth/active-profile";

function errorResponse(error: string, status: number, code?: string) {
  return NextResponse.json({ code, error, ok: false }, { status });
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("El cuerpo debe ser JSON válido.", 400, "INVALID_JSON");
  }
  const validation = validatePlayTimePayload(payload);
  if (!validation.ok) return errorResponse(validation.error, 400, "INVALID_PAYLOAD");
  const supabase = await createCookieOrBearerAuthenticatedClient(request);
  if (!supabase) return errorResponse("Supabase no está configurado.", 500, "NOT_CONFIGURED");
  const usesBearer = request.headers
    .get("authorization")
    ?.toLowerCase()
    .startsWith("bearer ") === true;
  let userId: string | null = null;
  if (usesBearer) {
    const { data, error } = await supabase.auth.getUser();
    userId = error ? null : data.user?.id ?? null;
  } else {
    const identity = await getVerifiedProductIdentity(supabase.auth);
    userId = identity.status === "product" ? identity.userId : null;
  }
  if (!userId) {
    return errorResponse("Necesitas una sesión válida.", 401, "AUTH_REQUIRED");
  }
  const profileState = await hasActiveProfile(supabase, userId);
  if (profileState.error) {
    return errorResponse("No se pudo validar el perfil.", 500, "PROFILE_CHECK_FAILED");
  }
  if (!profileState.active) {
    return errorResponse("La cuenta no puede ingerir Playtime.", 403, "ACTIVE_PROFILE_REQUIRED");
  }
  const event = validation.value;
  const { data, error } = await supabase.rpc("ingest_play_time_event", {
    p_client_version: event.clientVersion,
    p_duration_seconds: event.durationSeconds,
    p_ended_at: event.endedAt,
    p_event_id: event.eventId,
    p_local_game_key: event.gameKey,
    p_mode: event.mode,
    p_rom_name: event.rom,
    p_started_at: event.startedAt,
    p_week_id: event.weekId,
  });
  if (error) {
    const code = error.code || "PLAYTIME_INGEST_FAILED";
    if (code === "P0002") return errorResponse("La semana no existe o no tiene juego asignado.", 404, code);
    if (code === "22023") return errorResponse("El evento no cumple el contrato de Playtime.", 400, code);
    if (code === "42501") return errorResponse("La sesión no puede ingerir Playtime.", 403, code);
    return errorResponse("No se pudo guardar Playtime.", 500, code);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return errorResponse("La operación no devolvió resultado.", 500, "EMPTY_RPC_RESULT");
  return NextResponse.json({
    duplicate: row.duplicate === true,
    gameTotalSeconds: Number(row.game_total_seconds) || 0,
    ok: true,
    totalSeconds: Number(row.total_seconds) || 0,
  }, { status: row.duplicate === true ? 200 : 201 });
}
