import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";

type RouteContext = {
  params: Promise<{
    submissionId: string;
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

  const { submissionId } = await params;
  let payload: { isValid?: unknown };

  try {
    payload = (await request.json()) as { isValid?: unknown };
  } catch {
    return jsonError("Payload JSON inválido.");
  }

  if (typeof payload.isValid !== "boolean") {
    return jsonError("isValid debe ser booleano.");
  }

  const { data, error } = await auth.supabase
    .from("submissions")
    .update({ is_valid: payload.isValid })
    .eq("id", submissionId)
    .select("id,is_valid")
    .maybeSingle<{ id: string; is_valid: boolean }>();

  if (error) {
    return jsonError("No se pudo actualizar la submission.", 500);
  }

  if (!data) {
    return jsonError("Submission no encontrada.", 404);
  }

  return NextResponse.json({
    ok: true,
    submission: { id: data.id, isValid: data.is_valid },
  });
}
