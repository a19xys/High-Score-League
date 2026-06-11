import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { validateHomePollPayload } from "@/lib/admin/home-polls";
import { getAdminHomePoll, saveAdminHomePoll } from "@/lib/data/admin-polls";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  const result = await getAdminHomePoll(auth.supabase);

  if (result.error || !result.data) {
    return jsonError(result.error ?? "No se pudo cargar el cuestionario.", 500);
  }

  return NextResponse.json({ ok: true, data: result.data });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();

  if (!auth.ok) {
    return jsonError(auth.error, auth.status);
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonError("Payload JSON inválido.");
  }

  const validated = validateHomePollPayload(payload);

  if (!validated.ok) {
    return jsonError(validated.error);
  }

  const result = await saveAdminHomePoll(auth.supabase, validated.data);

  if (!result.ok) {
    return jsonError(result.error ?? "No se pudo guardar el cuestionario.", 500);
  }

  const data = await getAdminHomePoll(auth.supabase);

  return NextResponse.json({ ok: true, data: data.data });
}
