import { NextResponse } from "next/server";
import { getPublicHomePoll } from "@/lib/data/home-poll";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

  const { data, error: userError } = await supabase.auth.getUser();
  const user = data.user;

  if (userError || !user) {
    return jsonError("Necesitas iniciar sesión.", 401);
  }

  const result = await getPublicHomePoll(supabase, user.id);

  if (result.error) {
    return jsonError("No se pudo cargar el cuestionario.", 500);
  }

  return NextResponse.json({ ok: true, poll: result.poll });
}
