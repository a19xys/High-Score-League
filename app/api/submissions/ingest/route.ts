import { type NextRequest, NextResponse } from "next/server";
import { createCookieOrBearerAuthenticatedClient } from "@/lib/auth/request-client";
import { getVerifiedProductIdentity } from "@/lib/auth/session-context";
import { deriveSubmissionWindowAt } from "@/lib/submission-window";
import type { SubmissionSource, WeekRow } from "@/types/supabase";
import { hasActiveProfile } from "@/lib/auth/active-profile";

const allowedSources = [
  "web",
  "mame_memory",
  "mame_plugin",
  "local_app",
  "admin_import",
] as const satisfies readonly SubmissionSource[];

const maxCommentLength = 500;
const isoWithTimeZonePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type IngestPayload = {
  weekId?: unknown;
  playerId?: unknown;
  score?: unknown;
  detectedAt?: unknown;
  submittedAt?: unknown;
  source?: unknown;
  rom?: unknown;
  mameVersion?: unknown;
  clientVersion?: unknown;
  comment?: unknown;
  rawEvent?: unknown;
  duplicateKey?: unknown;
  isHidden?: unknown;
};

type ValidationResult =
  | {
      ok: true;
      value: {
        weekId: string;
        score: number;
        detectedAt: string;
        source: SubmissionSource;
        romName: string | null;
        mameVersion: string | null;
        clientVersion: string | null;
        comment: string | null;
        rawEvent: Record<string, unknown> | null;
        duplicateKey: string | null;
        isHidden: boolean | null;
      };
    }
  | { ok: false; status: number; error: string };

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function jsonCodeError(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function optionalNonEmptyString(value: unknown, field: string) {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false as const, error: `${field} debe ser texto.` };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: false as const, error: `${field} no puede estar vacío.` };
  }

  return { ok: true as const, value: trimmed };
}

function validatePayload(payload: IngestPayload): ValidationResult {
  if (payload.playerId !== undefined) {
    return {
      ok: false,
      status: 400,
      error: "playerId no se acepta desde cliente.",
    };
  }

  if (payload.submittedAt !== undefined) {
    return {
      ok: false,
      status: 400,
      error: "submittedAt no se acepta desde cliente.",
    };
  }

  if (typeof payload.weekId !== "string" || !payload.weekId.trim()) {
    return { ok: false, status: 400, error: "weekId es obligatorio." };
  }

  if (
    typeof payload.score !== "number" ||
    !Number.isInteger(payload.score) ||
    payload.score < 0
  ) {
    return {
      ok: false,
      status: 400,
      error: "score debe ser un entero mayor o igual que 0.",
    };
  }

  if (
    typeof payload.detectedAt !== "string" ||
    !isoWithTimeZonePattern.test(payload.detectedAt) ||
    Number.isNaN(new Date(payload.detectedAt).getTime())
  ) {
    return {
      ok: false,
      status: 400,
      error: "detectedAt debe ser una fecha ISO válida con zona horaria.",
    };
  }

  if (
    typeof payload.source !== "string" ||
    !allowedSources.includes(payload.source as SubmissionSource)
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "source debe ser uno de: web, mame_memory, mame_plugin, local_app, admin_import.",
    };
  }

  const rom = optionalNonEmptyString(payload.rom, "rom");
  if (!rom.ok) {
    return { ok: false, status: 400, error: rom.error };
  }

  const mameVersion = optionalNonEmptyString(payload.mameVersion, "mameVersion");
  if (!mameVersion.ok) {
    return { ok: false, status: 400, error: mameVersion.error };
  }

  const clientVersion = optionalNonEmptyString(
    payload.clientVersion,
    "clientVersion",
  );
  if (!clientVersion.ok) {
    return { ok: false, status: 400, error: clientVersion.error };
  }

  const comment = optionalNonEmptyString(payload.comment, "comment");
  if (!comment.ok) {
    return { ok: false, status: 400, error: comment.error };
  }

  if (comment.value && comment.value.length > maxCommentLength) {
    return {
      ok: false,
      status: 400,
      error: `comment no puede superar ${maxCommentLength} caracteres.`,
    };
  }

  if (
    payload.rawEvent !== undefined &&
    payload.rawEvent !== null &&
    (typeof payload.rawEvent !== "object" || Array.isArray(payload.rawEvent))
  ) {
    return {
      ok: false,
      status: 400,
      error: "rawEvent debe ser un objeto JSON si se envía.",
    };
  }

  const duplicateKey = optionalNonEmptyString(
    payload.duplicateKey,
    "duplicateKey",
  );
  if (!duplicateKey.ok) {
    return { ok: false, status: 400, error: duplicateKey.error };
  }

  if (
    payload.isHidden !== undefined &&
    payload.isHidden !== null &&
    typeof payload.isHidden !== "boolean"
  ) {
    return { ok: false, status: 400, error: "isHidden debe ser booleano." };
  }

  return {
    ok: true,
    value: {
      weekId: payload.weekId.trim(),
      score: payload.score,
      detectedAt: payload.detectedAt,
      source: payload.source as SubmissionSource,
      romName: rom.value,
      mameVersion: mameVersion.value,
      clientVersion: clientVersion.value,
      comment: comment.value,
      rawEvent: (payload.rawEvent ?? null) as Record<string, unknown> | null,
      duplicateKey: duplicateKey.value,
      isHidden:
        typeof payload.isHidden === "boolean" ? payload.isHidden : null,
    },
  };
}

type ExistingSubmission = {
  detected_at: string | null;
  id: string;
  score: number;
  submitted_at: string;
  week_id: string;
};

function canonicalEventMatches(
  existing: ExistingSubmission,
  input: { detectedAt: string; score: number; weekId: string },
) {
  return (
    existing.week_id === input.weekId &&
    Number(existing.score) === input.score &&
    existing.detected_at !== null &&
    Date.parse(existing.detected_at) === Date.parse(input.detectedAt)
  );
}

function duplicateResponse(existing: ExistingSubmission) {
  return NextResponse.json(
    {
      ok: true,
      duplicate: true,
      submission: {
        id: existing.id,
        submittedAt: existing.submitted_at,
      },
    },
    { status: 200 },
  );
}

function duplicateConflict() {
  return jsonCodeError(
    "DUPLICATE_KEY_CONFLICT",
    "La clave de duplicado ya identifica otro evento competitivo.",
    409,
  );
}

function isSubmissionPolicyError(error: { code?: string; message?: string }) {
  return (
    error.code === "42501" ||
    /row-level security|row level security|policy/i.test(error.message ?? "")
  );
}

export async function POST(request: NextRequest) {
  let payload: IngestPayload;

  try {
    payload = (await request.json()) as IngestPayload;
  } catch {
    return jsonError("El cuerpo debe ser JSON válido.");
  }

  const validation = validatePayload(payload);

  if (!validation.ok) {
    return jsonError(validation.error, validation.status);
  }

  const supabase = await createCookieOrBearerAuthenticatedClient(request);

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

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
    return jsonError("Necesitas una sesión válida para enviar puntuaciones.", 401);
  }

  const profileState = await hasActiveProfile(supabase, userId);

  if (profileState.error) {
    return jsonCodeError(
      "PROFILE_CHECK_FAILED",
      "No se pudo validar el perfil activo.",
      500,
    );
  }

  if (!profileState.active) {
    return jsonCodeError(
      "ACTIVE_PROFILE_REQUIRED",
      "La cuenta no puede enviar puntuaciones.",
      403,
    );
  }

  const input = validation.value;

  if (input.duplicateKey) {
    const { data: existing, error: duplicateError } = await supabase
      .from("submissions")
      .select("id,week_id,score,detected_at,submitted_at")
      .eq("player_id", userId)
      .eq("duplicate_key", input.duplicateKey)
      .maybeSingle<ExistingSubmission>();

    if (duplicateError) {
      return jsonCodeError(
        "SUBMISSION_DATABASE_ERROR",
        "No se pudo comprobar la idempotencia de la submission.",
        500,
      );
    }

    if (existing) {
      return canonicalEventMatches(existing, input)
        ? duplicateResponse(existing)
        : duplicateConflict();
    }
  }

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select(
      "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at",
    )
    .eq("id", input.weekId)
    .maybeSingle<WeekRow>();

  if (weekError) {
    return jsonError("No se pudo validar la semana.", 500);
  }

  if (!week) {
    return jsonCodeError(
      "WEEK_NOT_FOUND",
      "La semana indicada no existe o no es visible.",
      404,
    );
  }

  if (!week.game_id) {
    return jsonCodeError(
      "WEEK_GAME_NOT_ASSIGNED",
      "La semana no tiene juego asignado.",
      409,
    );
  }

  const { data: membership, error: membershipError } = await supabase
    .from("season_memberships")
    .select("id")
    .eq("season_id", week.season_id)
    .eq("player_id", userId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();

  if (membershipError) {
    return jsonCodeError(
      "MEMBERSHIP_CHECK_FAILED",
      "No se pudo comprobar la pertenencia a la temporada.",
      500,
    );
  }

  if (!membership) {
    return jsonCodeError(
      "NOT_SEASON_MEMBER",
      "No perteneces a la temporada de esta semana.",
      403,
    );
  }

  const historicalWindow = deriveSubmissionWindowAt(week, input.detectedAt);

  if (!historicalWindow.accepted && historicalWindow.code) {
    const messages = {
      DETECTED_AT_IN_FUTURE:
        "La fecha de detección supera el margen de reloj permitido.",
      WEEK_CLOSED_AT_DETECTION:
        "La puntuación se detectó cuando la semana ya estaba cerrada.",
      WEEK_NOT_OPEN_AT_DETECTION:
        "La puntuación se detectó antes de la apertura de la semana.",
      WEEK_WINDOW_UNAVAILABLE:
        "La semana no tiene una ventana competitiva válida.",
    } satisfies Record<NonNullable<typeof historicalWindow.code>, string>;

    return jsonCodeError(
      historicalWindow.code,
      messages[historicalWindow.code],
      409,
    );
  }

  const isHidden = historicalWindow.forceHidden || input.isHidden === true;

  const { data: inserted, error: insertError } = await supabase
    .from("submissions")
    .insert({
      week_id: input.weekId,
      player_id: userId,
      score: input.score,
      source: input.source,
      detected_at: input.detectedAt,
      rom_name: input.romName,
      mame_version: input.mameVersion,
      client_version: input.clientVersion,
      raw_event: input.rawEvent,
      duplicate_key: input.duplicateKey,
      comment: input.comment,
      is_hidden: isHidden,
      is_valid: true,
    })
    .select(
      "id,week_id,player_id,score,is_hidden,is_valid,source,detected_at,submitted_at,duplicate_key",
    )
    .single();

  if (insertError) {
    if (insertError.code === "23505" && input.duplicateKey) {
      const { data: existing, error: duplicateError } = await supabase
        .from("submissions")
        .select("id,week_id,score,detected_at,submitted_at")
        .eq("player_id", userId)
        .eq("duplicate_key", input.duplicateKey)
        .maybeSingle<ExistingSubmission>();

      if (!duplicateError && existing) {
        return canonicalEventMatches(existing, input)
          ? duplicateResponse(existing)
          : duplicateConflict();
      }
    }

    if (isSubmissionPolicyError(insertError)) {
      return jsonCodeError(
        "SUBMISSION_POLICY_REJECTED",
        "La política de persistencia rechazó una submission validada por la API.",
        409,
      );
    }

    return jsonCodeError(
      "SUBMISSION_DATABASE_ERROR",
      "No se pudo guardar la submission.",
      500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      duplicate: false,
      submission: {
        id: inserted.id,
        weekId: inserted.week_id,
        playerId: inserted.player_id,
        score: inserted.score,
        isHidden: inserted.is_hidden,
        isValid: inserted.is_valid,
        source: inserted.source,
        detectedAt: inserted.detected_at,
        submittedAt: inserted.submitted_at,
        duplicateKey: inserted.duplicate_key,
      },
    },
    { status: 201 },
  );
}
