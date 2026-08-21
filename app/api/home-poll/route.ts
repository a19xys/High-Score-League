import { NextResponse } from "next/server";
import { getPublicHomePoll } from "@/lib/data/home-poll";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVerifiedProductIdentity } from "@/lib/auth/session-context";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

  const identity = await getVerifiedProductIdentity(supabase.auth);

  if (identity.status !== "product") {
    return jsonError("Necesitas iniciar sesión.", 401);
  }

  const result = await getPublicHomePoll(supabase, identity.userId);

  if (result.error) {
    return jsonError("No se pudo cargar el cuestionario.", 500);
  }

  return NextResponse.json({ ok: true, poll: result.poll });
}
