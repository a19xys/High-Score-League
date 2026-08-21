import { type NextRequest, NextResponse } from "next/server";
import { createBearerAuthenticatedClient } from "@/lib/auth/request-client";
import { clearPlayerPresence, commitPlayerPresence } from "@/lib/data/player-presence";
import {
  validateLauncherPresencePayload,
  validatePresenceDeletePayload,
} from "@/lib/presence-contract";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 2_048;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function readPayload(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return { tooLarge: true } as const;
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return { tooLarge: true } as const;
    return { payload: JSON.parse(raw) as unknown } as const;
  } catch {
    return { invalid: true } as const;
  }
}

async function authenticated(request: NextRequest) {
  const supabase = createBearerAuthenticatedClient(request);
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user;
}

export async function POST(request: NextRequest) {
  const parsed = await readPayload(request);
  if ("tooLarge" in parsed) return json({ ok: false, error: "El payload es demasiado grande." }, 413);
  if ("invalid" in parsed) return json({ ok: false, error: "El cuerpo debe ser JSON válido." }, 400);
  const validation = validateLauncherPresencePayload(parsed.payload);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
  const user = await authenticated(request);
  if (!user) return json({ ok: false, error: "Necesitas una sesión válida." }, 401);
  const admin = createSupabaseAdminClient();
  if (!admin) return json({ ok: false, error: "Presence no está configurada." }, 503);
  const committed = await commitPlayerPresence(admin, {
    activity: validation.value.activity,
    clientId: validation.value.clientId,
    mode: validation.value.mode,
    playerId: user.id,
    source: "launcher",
    weekId: validation.value.weekId,
  });
  if (committed.error) return json({ ok: false, error: "Presence no está disponible." }, 503);
  return json({ ok: true, private: committed.private });
}

export async function DELETE(request: NextRequest) {
  const parsed = await readPayload(request);
  if ("tooLarge" in parsed) return json({ ok: false, error: "El payload es demasiado grande." }, 413);
  if ("invalid" in parsed) return json({ ok: false, error: "El cuerpo debe ser JSON válido." }, 400);
  const validation = validatePresenceDeletePayload(parsed.payload);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
  const user = await authenticated(request);
  if (!user) return json({ ok: false, error: "Necesitas una sesión válida." }, 401);
  const admin = createSupabaseAdminClient();
  if (!admin) return json({ ok: false, error: "Presence no está configurada." }, 503);
  const cleared = await clearPlayerPresence(admin, {
    clientId: validation.value.clientId,
    playerId: user.id,
    source: "launcher",
  });
  if (cleared.error) return json({ ok: false, error: "Presence no está disponible." }, 503);
  return json({ ok: true });
}
