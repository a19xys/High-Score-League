import { type NextRequest, NextResponse } from "next/server";
import { createCookieAuthenticatedClient } from "@/lib/auth/request-client";
import { commitPlayerPresence } from "@/lib/data/player-presence";
import { validateWebPresencePayload } from "@/lib/presence-contract";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 2_048;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: "El payload es demasiado grande." }, 413);
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return json({ ok: false, error: "El payload es demasiado grande." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "El cuerpo debe ser JSON válido." }, 400);
  }
  const validation = validateWebPresencePayload(payload);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);

  const supabase = await createCookieAuthenticatedClient();
  if (!supabase) return json({ ok: false, error: "Presence no está configurada." }, 503);
  const { data, error: userError } = await supabase.auth.getUser();
  const user = data.user;
  if (userError || !user) return json({ ok: false, error: "Necesitas una sesión válida." }, 401);

  const admin = createSupabaseAdminClient();
  if (!admin) return json({ ok: false, error: "Presence no está configurada." }, 503);
  const committed = await commitPlayerPresence(admin, {
    activity: "connected",
    clientId: validation.value.clientId,
    mode: null,
    playerId: user.id,
    source: "web",
    weekId: null,
  });
  if (committed.error) return json({ ok: false, error: "Presence no está disponible." }, 503);
  return json({ ok: true, private: committed.private });
}
