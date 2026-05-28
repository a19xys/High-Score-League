import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSynchronizedWeekStatus } from "@/lib/week-status";
import type { SubmissionSource, WeekRow } from "@/types/supabase";

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

async function createAuthenticatedClient(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const env = getSupabaseEnv();

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    if (!env.isConfigured || !env.url || !env.anonKey) {
      return null;
    }

    return createClient(env.url, env.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });
  }

  return createSupabaseServerClient();
}

function resolveHiddenState(week: WeekRow, requestedHidden: boolean | null) {
  const synchronizedStatus = getSynchronizedWeekStatus(week);

  if (synchronizedStatus === "active") {
    return { ok: true as const, isHidden: requestedHidden ?? false };
  }

  if (synchronizedStatus === "frozen") {
    return { ok: true as const, isHidden: true };
  }

  const messages = {
    draft: "La semana todavía no ha abierto y no admite submissions.",
    active: "",
    frozen: "",
    closed: "La semana ya está cerrada y no admite submissions.",
    published: "La semana ya tiene resultados publicados y no admite submissions.",
  } satisfies Record<string, string>;

  return {
    ok: false as const,
    status: 409,
    error: messages[synchronizedStatus],
  };
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

  const supabase = await createAuthenticatedClient(request);

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas una sesión válida para enviar puntuaciones.", 401);
  }

  const input = validation.value;

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
    return jsonError("La semana indicada no existe o no es visible.", 404);
  }

  const hiddenState = resolveHiddenState(week, input.isHidden);

  if (!hiddenState.ok) {
    return jsonError(hiddenState.error, hiddenState.status);
  }

  if (input.duplicateKey) {
    const { data: existing } = await supabase
      .from("submissions")
      .select("id,submitted_at")
      .eq("duplicate_key", input.duplicateKey)
      .maybeSingle<{ id: string; submitted_at: string }>();

    if (existing) {
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
  }

  const { data: inserted, error: insertError } = await supabase
    .from("submissions")
    .insert({
      week_id: input.weekId,
      player_id: userData.user.id,
      score: input.score,
      source: input.source,
      detected_at: input.detectedAt,
      rom_name: input.romName,
      mame_version: input.mameVersion,
      client_version: input.clientVersion,
      raw_event: input.rawEvent,
      duplicate_key: input.duplicateKey,
      comment: input.comment,
      is_hidden: hiddenState.isHidden,
      is_valid: true,
    })
    .select(
      "id,week_id,player_id,score,is_hidden,is_valid,source,detected_at,submitted_at,duplicate_key",
    )
    .single();

  if (insertError) {
    if (insertError.code === "23505" && input.duplicateKey) {
      return NextResponse.json(
        {
          ok: true,
          duplicate: true,
          submission: null,
        },
        { status: 200 },
      );
    }

    return jsonError("No se pudo guardar la submission.", 500);
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
