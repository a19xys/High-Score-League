import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminHomePoll, resetAdminHomePoll } from "@/lib/data/admin-polls";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST() {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const result = await resetAdminHomePoll(auth.supabase);

  if (!result.ok) {
    return jsonError(result.error ?? "No se pudo reiniciar el cuestionario.", 500);
  }

  const data = await getAdminHomePoll(auth.supabase);

  return NextResponse.json({ ok: true, data: data.data });
}
