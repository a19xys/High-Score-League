import { type NextRequest, NextResponse } from "next/server";
import {
  AccountAnonymizationError,
  anonymizeAccount,
} from "@/lib/account-anonymization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getVerifiedProductIdentity } from "@/lib/auth/session-context";

export const dynamic = "force-dynamic";

type ProfileState = {
  anonymized_at: string | null;
  id: string;
  username: string;
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function errorResponse(code: string, error: string, status: number, retryable = false) {
  return response({ ok: false, code, error, retryable }, status);
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return errorResponse(
      "NOT_CONFIGURED",
      "La eliminación de cuenta no está disponible en este entorno.",
      503,
      true,
    );
  }

  const identity = await getVerifiedProductIdentity(supabase.auth);

  if (identity.status !== "product") {
    return errorResponse("AUTH_REQUIRED", "Necesitas una sesión válida.", 401);
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return errorResponse(
      "NOT_CONFIGURED",
      "La eliminación de cuenta no está disponible en este entorno.",
      503,
      true,
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("INVALID_PAYLOAD", "El cuerpo debe ser JSON válido.", 400);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse("INVALID_PAYLOAD", "El cuerpo debe ser un objeto JSON.", 400);
  }

  const record = payload as Record<string, unknown>;
  const forbiddenFields = [
    "anonymousAlias",
    "avatarPath",
    "email",
    "isAdmin",
    "playerId",
    "profileId",
  ];

  if (forbiddenFields.some((field) => field in record)) {
    return errorResponse(
      "IDENTITY_FIELD_NOT_ALLOWED",
      "La identidad de la cuenta se deriva siempre de la sesión.",
      400,
    );
  }

  if (typeof record.username !== "string" || record.acknowledged !== true) {
    return errorResponse(
      "CONFIRMATION_REQUIRED",
      "Escribe tu username exacto y confirma que la acción es irreversible.",
      400,
    );
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,username,anonymized_at")
    .eq("id", identity.userId)
    .maybeSingle<ProfileState>();

  if (profileError) {
    return errorResponse(
      "PROFILE_CHECK_FAILED",
      "No se pudo validar el estado de la cuenta.",
      500,
      true,
    );
  }

  if (!profile) {
    return errorResponse("PROFILE_NOT_FOUND", "No existe un perfil que anonimizar.", 404);
  }

  if (profile.anonymized_at === null && record.username !== profile.username) {
    return errorResponse(
      "USERNAME_MISMATCH",
      "El username escrito no coincide con el de la cuenta.",
      400,
    );
  }

  try {
    await anonymizeAccount({ admin, userId: identity.userId });
  } catch (caught) {
    if (caught instanceof AccountAnonymizationError) {
      return errorResponse(caught.code, caught.message, caught.status, caught.retryable);
    }

    return errorResponse(
      "ANONYMIZATION_FAILED",
      "No se pudo completar la eliminación de la cuenta.",
      500,
      true,
    );
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });

  if (signOutError) {
    console.warn("Account anonymization completed; session cleanup will continue client-side.");
  }

  return response({ ok: true }, 200);
}
