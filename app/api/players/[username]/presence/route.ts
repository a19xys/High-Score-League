import { type NextRequest, NextResponse } from "next/server";
import { usernamePattern } from "@/lib/auth/validation";
import { getPlayerPresence } from "@/lib/data/player-presence";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasActiveProfile } from "@/lib/auth/active-profile";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return json({ ok: false, error: "Presence no está configurada." }, 503);
  const { data: viewer } = await supabase.auth.getUser();
  if (!viewer.user) return json({ ok: false, error: "Necesitas una sesión válida." }, 401);
  const viewerProfile = await hasActiveProfile(supabase, viewer.user.id);
  if (viewerProfile.error) return json({ ok: false, error: "Presence no está disponible." }, 503);
  if (!viewerProfile.active) return json({ ok: false, error: "Necesitas un perfil activo." }, 403);

  const { username } = await params;
  if (!usernamePattern.test(username)) return json({ ok: false, error: "Jugador no válido." }, 400);
  const admin = createSupabaseAdminClient();
  if (!admin) return json({ ok: false, error: "Presence no está configurada." }, 503);
  const target = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .is("anonymized_at", null)
    .maybeSingle<{ id: string }>();
  if (target.error) return json({ ok: false, error: "Presence no está disponible." }, 503);
  if (!target.data) return json({ ok: false, error: "Jugador no encontrado." }, 404);

  const presence = await getPlayerPresence(target.data.id, { admin });
  return json({ ok: true, presence }, presence.visibility === "unavailable" ? 503 : 200);
}
