import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveSubmissionWindowAt } from "../submission-window.ts";
import {
  rawEventClaimsProtected,
  validateCompetitionPackAuthority,
  validateCompetitionPolicyRow,
  validateProtectedCompetitionSubmission,
  type ProtectedSubmissionIdentity,
} from "../submissions/competition-integrity.ts";
import type { SubmissionSource, WeekRow } from "../../types/supabase.ts";

const ALLOWED_SOURCES = new Set<SubmissionSource>([
  "web",
  "mame_memory",
  "mame_plugin",
  "local_app",
  "admin_import",
]);
const MAX_COMMENT_LENGTH = 500;
const ISO_WITH_TIME_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type JsonObject = Record<string, unknown>;

export type IngestPayload = {
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

export type ValidatedIngestInput = {
  weekId: string;
  score: number;
  detectedAt: string;
  source: SubmissionSource;
  romName: string | null;
  mameVersion: string | null;
  clientVersion: string | null;
  comment: string | null;
  rawEvent: JsonObject | null;
  duplicateKey: string | null;
  isHidden: boolean | null;
};

export type ExistingSubmission = {
  id: string;
  week_id: string;
  player_id: string;
  score: number;
  source: SubmissionSource;
  detected_at: string | null;
  submitted_at: string;
  rom_name: string | null;
  mame_version: string | null;
  duplicate_key: string | null;
  launcher_pack_id: string | null;
  competition_integrity_version: number | null;
  competition_manifest_sha256: string | null;
  competition_policy_fingerprint: string | null;
  competition_run_id: string | null;
  competition_candidate_id: string | null;
};

export type SubmissionInsertRow = {
  week_id: string;
  player_id: string;
  score: number;
  source: SubmissionSource;
  detected_at: string;
  rom_name: string | null;
  mame_version: string | null;
  client_version: string | null;
  raw_event: JsonObject | null;
  duplicate_key: string | null;
  comment: string | null;
  is_hidden: boolean;
  is_valid: true;
  launcher_pack_id: string | null;
  competition_integrity_version: 2 | null;
  competition_manifest_sha256: string | null;
  competition_policy_fingerprint: string | null;
  competition_run_id: string | null;
  competition_candidate_id: string | null;
};

type QueryResult<T> = { data: T | null; error: unknown };
type InsertResult = { data: Record<string, unknown> | null; error: unknown };
type ErrorShape = { code?: string; message?: string };

export type SubmissionIngestResult = {
  status: number;
  body: Record<string, unknown>;
};

export type SubmissionIngestDependencies = {
  authenticate(): Promise<{ userId: string | null; unavailable?: boolean }>;
  checkActiveProfile(userId: string): Promise<{ active: boolean; error: string | null }>;
  createAdminClient(): unknown | null;
  loadWeek(client: unknown, weekId: string): Promise<QueryResult<WeekRow>>;
  loadPolicy(client: unknown, weekId: string): Promise<QueryResult<unknown>>;
  loadPack(client: unknown, packId: string): Promise<QueryResult<unknown>>;
  findDuplicate(client: unknown, playerId: string, duplicateKey: string): Promise<QueryResult<ExistingSubmission>>;
  loadMembership(client: unknown, seasonId: string, playerId: string): Promise<QueryResult<{ id: string }>>;
  insertSubmission(client: unknown, row: SubmissionInsertRow): Promise<InsertResult>;
  now(): Date;
};

function result(status: number, body: Record<string, unknown>): SubmissionIngestResult {
  return { status, body };
}

function errorResult(status: number, code: string, error: string) {
  return result(status, { ok: false, code, error });
}

function authorityUnavailable() {
  return errorResult(
    503,
    "COMPETITION_AUTHORITY_UNAVAILABLE",
    "La autoridad competitiva del servidor no está disponible temporalmente.",
  );
}

function optionalString(value: unknown, field: string, maximum = 256) {
  if (value === undefined || value === null) return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const, error: `${field} debe ser texto.` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false as const, error: `${field} no puede estar vacío.` };
  if (trimmed.length > maximum) return { ok: false as const, error: `${field} es demasiado largo.` };
  return { ok: true as const, value: trimmed };
}

export function validateIngestPayload(payload: unknown):
  | { ok: true; value: ValidatedIngestInput }
  | { ok: false; status: number; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status: 400, error: "El cuerpo debe ser un objeto JSON." };
  }
  const input = payload as IngestPayload;
  if (input.playerId !== undefined) {
    return { ok: false, status: 400, error: "playerId no se acepta desde cliente." };
  }
  if (input.submittedAt !== undefined) {
    return { ok: false, status: 400, error: "submittedAt no se acepta desde cliente." };
  }
  if (typeof input.weekId !== "string" || !input.weekId.trim()) {
    return { ok: false, status: 400, error: "weekId es obligatorio." };
  }
  if (typeof input.score !== "number" || !Number.isInteger(input.score) || input.score < 0) {
    return { ok: false, status: 400, error: "score debe ser un entero mayor o igual que 0." };
  }
  if (typeof input.detectedAt !== "string"
      || !ISO_WITH_TIME_ZONE_PATTERN.test(input.detectedAt)
      || Number.isNaN(new Date(input.detectedAt).getTime())) {
    return { ok: false, status: 400, error: "detectedAt debe ser una fecha ISO válida con zona horaria." };
  }
  if (typeof input.source !== "string" || !ALLOWED_SOURCES.has(input.source as SubmissionSource)) {
    return { ok: false, status: 400, error: "source no es válido." };
  }
  const rom = optionalString(input.rom, "rom", 64);
  const mameVersion = optionalString(input.mameVersion, "mameVersion", 32);
  const clientVersion = optionalString(input.clientVersion, "clientVersion", 64);
  const comment = optionalString(input.comment, "comment", MAX_COMMENT_LENGTH);
  const duplicateKey = optionalString(input.duplicateKey, "duplicateKey", 160);
  if (!rom.ok) return { ok: false, status: 400, error: rom.error };
  if (!mameVersion.ok) return { ok: false, status: 400, error: mameVersion.error };
  if (!clientVersion.ok) return { ok: false, status: 400, error: clientVersion.error };
  if (!comment.ok) return { ok: false, status: 400, error: comment.error };
  if (!duplicateKey.ok) return { ok: false, status: 400, error: duplicateKey.error };
  if (input.rawEvent !== undefined && input.rawEvent !== null
      && (typeof input.rawEvent !== "object" || Array.isArray(input.rawEvent))) {
    return { ok: false, status: 400, error: "rawEvent debe ser un objeto JSON si se envía." };
  }
  if (input.isHidden !== undefined && input.isHidden !== null && typeof input.isHidden !== "boolean") {
    return { ok: false, status: 400, error: "isHidden debe ser booleano." };
  }
  return {
    ok: true,
    value: {
      weekId: input.weekId.trim(),
      score: input.score,
      detectedAt: input.detectedAt,
      source: input.source as SubmissionSource,
      romName: rom.value,
      mameVersion: mameVersion.value,
      clientVersion: clientVersion.value,
      comment: comment.value,
      rawEvent: (input.rawEvent ?? null) as JsonObject | null,
      duplicateKey: duplicateKey.value,
      isHidden: typeof input.isHidden === "boolean" ? input.isHidden : null,
    },
  };
}

function sameDetectedAt(left: string | null, right: string) {
  return left !== null && Date.parse(left) === Date.parse(right);
}

function canonicalDuplicateMatches(
  existing: ExistingSubmission,
  input: ValidatedIngestInput,
  protectedIdentity: ProtectedSubmissionIdentity | null,
) {
  const baseMatches = existing.week_id === input.weekId
    && Number(existing.score) === input.score
    && sameDetectedAt(existing.detected_at, input.detectedAt);
  if (!baseMatches) return false;
  if (!protectedIdentity) {
    return existing.competition_integrity_version === null
      && existing.launcher_pack_id === null
      && existing.competition_manifest_sha256 === null
      && existing.competition_policy_fingerprint === null
      && existing.competition_run_id === null
      && existing.competition_candidate_id === null;
  }
  return existing.launcher_pack_id === protectedIdentity.launcherPackId
    && existing.competition_integrity_version === 2
    && existing.competition_manifest_sha256 === protectedIdentity.competitionManifestSha256
    && existing.competition_policy_fingerprint === protectedIdentity.competitionPolicyFingerprint
    && existing.competition_run_id === protectedIdentity.competitionRunId
    && existing.competition_candidate_id === protectedIdentity.competitionCandidateId
    && existing.rom_name === input.romName
    && existing.mame_version === input.mameVersion
    && existing.source === input.source;
}

function duplicateSuccess(existing: ExistingSubmission) {
  return result(200, {
    ok: true,
    duplicate: true,
    submission: { id: existing.id, submittedAt: existing.submitted_at },
  });
}

function duplicateConflict() {
  return errorResult(409, "DUPLICATE_KEY_CONFLICT", "La clave de duplicado identifica otro evento competitivo.");
}

function errorCode(error: unknown) {
  return (error && typeof error === "object" ? (error as ErrorShape).code : undefined) || null;
}

async function safeCall<T>(operation: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await operation() };
  } catch {
    return { ok: false };
  }
}

export async function resolveSubmissionIngest(
  payload: unknown,
  dependencies: SubmissionIngestDependencies,
): Promise<SubmissionIngestResult> {
  const validation = validateIngestPayload(payload);
  if (!validation.ok) return errorResult(validation.status, "INVALID_SUBMISSION", validation.error);
  const input = validation.value;

  const auth = await safeCall(() => dependencies.authenticate());
  if (!auth.ok || auth.value.unavailable) {
    return errorResult(503, "AUTH_UNAVAILABLE", "La autenticación no está disponible temporalmente.");
  }
  if (!auth.value.userId) {
    return errorResult(401, "AUTH_REQUIRED", "Necesitas una sesión válida para enviar puntuaciones.");
  }
  const userId = auth.value.userId;

  const profile = await safeCall(() => dependencies.checkActiveProfile(userId));
  if (!profile.ok || profile.value.error) {
    return errorResult(503, "PROFILE_CHECK_FAILED", "No se pudo validar el perfil activo.");
  }
  if (!profile.value.active) {
    return errorResult(403, "ACTIVE_PROFILE_REQUIRED", "La cuenta no puede enviar puntuaciones.");
  }

  let adminClient: unknown | null;
  try {
    adminClient = dependencies.createAdminClient();
  } catch {
    adminClient = null;
  }
  if (!adminClient) return authorityUnavailable();

  const weekResult = await safeCall(() => dependencies.loadWeek(adminClient, input.weekId));
  if (!weekResult.ok || weekResult.value.error) {
    return errorResult(503, "SUBMISSION_DATABASE_ERROR", "No se pudo validar la semana.");
  }
  const week = weekResult.value.data;
  if (!week) return errorResult(404, "WEEK_NOT_FOUND", "La semana indicada no existe.");
  if (!week.game_id) return errorResult(409, "WEEK_GAME_NOT_ASSIGNED", "La semana no tiene juego asignado.");

  const policyResult = await safeCall(() => dependencies.loadPolicy(adminClient, input.weekId));
  if (!policyResult.ok || policyResult.value.error) return authorityUnavailable();

  let protectedIdentity: ProtectedSubmissionIdentity | null = null;
  if (policyResult.value.data) {
    const policy = validateCompetitionPolicyRow(policyResult.value.data, input.weekId);
    if (!policy) return authorityUnavailable();
    const packResult = await safeCall(() => dependencies.loadPack(adminClient, policy.launcherPackId));
    if (!packResult.ok || packResult.value.error || !packResult.value.data) return authorityUnavailable();
    const pack = validateCompetitionPackAuthority(packResult.value.data, policy);
    if (!pack) return authorityUnavailable();
    const protectedValidation = validateProtectedCompetitionSubmission({
      input,
      authenticatedUserId: userId,
      authority: { policy, pack },
    });
    if (!protectedValidation.ok) {
      return errorResult(409, protectedValidation.code, protectedValidation.error);
    }
    protectedIdentity = protectedValidation.identity;
  } else if (rawEventClaimsProtected(input.rawEvent)) {
    return authorityUnavailable();
  }

  const effectiveDuplicateKey = protectedIdentity?.duplicateKey ?? input.duplicateKey;
  if (effectiveDuplicateKey) {
    const duplicate = await safeCall(() => dependencies.findDuplicate(adminClient, userId, effectiveDuplicateKey));
    if (!duplicate.ok || duplicate.value.error) {
      return errorResult(503, "SUBMISSION_DATABASE_ERROR", "No se pudo comprobar la idempotencia.");
    }
    if (duplicate.value.data) {
      return canonicalDuplicateMatches(duplicate.value.data, input, protectedIdentity)
        ? duplicateSuccess(duplicate.value.data)
        : duplicateConflict();
    }
  }

  const membership = await safeCall(() => dependencies.loadMembership(adminClient, week.season_id, userId));
  if (!membership.ok || membership.value.error) {
    return errorResult(503, "MEMBERSHIP_CHECK_FAILED", "No se pudo comprobar la pertenencia a la temporada.");
  }
  if (!membership.value.data) {
    return errorResult(403, "NOT_SEASON_MEMBER", "No perteneces a la temporada de esta semana.");
  }

  const historicalWindow = deriveSubmissionWindowAt(week, input.detectedAt, { now: dependencies.now() });
  if (!historicalWindow.accepted && historicalWindow.code) {
    return errorResult(409, historicalWindow.code, "La puntuación se detectó fuera de la ventana competitiva.");
  }
  const isHidden = historicalWindow.forceHidden || input.isHidden === true;
  const row: SubmissionInsertRow = {
    week_id: input.weekId,
    player_id: userId,
    score: input.score,
    source: input.source,
    detected_at: input.detectedAt,
    rom_name: input.romName,
    mame_version: input.mameVersion,
    client_version: input.clientVersion,
    raw_event: input.rawEvent,
    duplicate_key: effectiveDuplicateKey,
    comment: input.comment,
    is_hidden: isHidden,
    is_valid: true,
    launcher_pack_id: protectedIdentity?.launcherPackId ?? null,
    competition_integrity_version: protectedIdentity?.competitionIntegrityVersion ?? null,
    competition_manifest_sha256: protectedIdentity?.competitionManifestSha256 ?? null,
    competition_policy_fingerprint: protectedIdentity?.competitionPolicyFingerprint ?? null,
    competition_run_id: protectedIdentity?.competitionRunId ?? null,
    competition_candidate_id: protectedIdentity?.competitionCandidateId ?? null,
  };

  const insert = await safeCall(() => dependencies.insertSubmission(adminClient, row));
  if (!insert.ok) return errorResult(503, "SUBMISSION_DATABASE_ERROR", "No se pudo guardar la submission.");
  if (insert.value.error) {
    if (errorCode(insert.value.error) === "40001") {
      return errorResult(
        503,
        "COMPETITION_AUTHORITY_CHANGED",
        "La autoridad competitiva cambió mientras se guardaba la submission.",
      );
    }
    if (errorCode(insert.value.error) === "23505" && effectiveDuplicateKey) {
      const duplicate = await safeCall(() => dependencies.findDuplicate(adminClient, userId, effectiveDuplicateKey));
      if (duplicate.ok && !duplicate.value.error && duplicate.value.data) {
        return canonicalDuplicateMatches(duplicate.value.data, input, protectedIdentity)
          ? duplicateSuccess(duplicate.value.data)
          : duplicateConflict();
      }
    }
    return errorResult(503, "SUBMISSION_DATABASE_ERROR", "No se pudo guardar la submission.");
  }
  const inserted = insert.value.data;
  if (!inserted || typeof inserted.id !== "string") {
    return errorResult(503, "SUBMISSION_DATABASE_ERROR", "No se pudo verificar la submission guardada.");
  }
  return result(201, {
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
  });
}

const WEEK_COLUMNS = "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";
const POLICY_COLUMNS = "week_id,policy_version,mode,launcher_pack_id,evidence_version,guard_version,rom_name,mame_version,plugin_version,source,dips,policy_fingerprint,frozen_at,created_at,updated_at";
const PACK_COLUMNS = "pack_id,week_id,size_bytes,sha256,competition_manifest_sha256,status,published_at";
const DUPLICATE_COLUMNS = "id,week_id,player_id,score,source,detected_at,submitted_at,rom_name,mame_version,duplicate_key,launcher_pack_id,competition_integrity_version,competition_manifest_sha256,competition_policy_fingerprint,competition_run_id,competition_candidate_id";

export async function loadSubmissionWeek(client: unknown, weekId: string): Promise<QueryResult<WeekRow>> {
  const response = await (client as SupabaseClient)
    .from("weeks")
    .select(WEEK_COLUMNS)
    .eq("id", weekId)
    .maybeSingle<WeekRow>();
  return { data: response.data, error: response.error };
}

export async function loadCompetitionPolicy(client: unknown, weekId: string): Promise<QueryResult<unknown>> {
  const response = await (client as SupabaseClient)
    .from("week_competition_policies")
    .select(POLICY_COLUMNS)
    .eq("week_id", weekId)
    .maybeSingle();
  return { data: response.data, error: response.error };
}

export async function loadCompetitionPack(client: unknown, packId: string): Promise<QueryResult<unknown>> {
  const response = await (client as SupabaseClient)
    .from("launcher_packs")
    .select(PACK_COLUMNS)
    .eq("pack_id", packId)
    .maybeSingle();
  return { data: response.data, error: response.error };
}

export async function findSubmissionDuplicate(
  client: unknown,
  playerId: string,
  duplicateKey: string,
): Promise<QueryResult<ExistingSubmission>> {
  const response = await (client as SupabaseClient)
    .from("submissions")
    .select(DUPLICATE_COLUMNS)
    .eq("player_id", playerId)
    .eq("duplicate_key", duplicateKey)
    .maybeSingle<ExistingSubmission>();
  return { data: response.data, error: response.error };
}

export async function loadSubmissionMembership(
  client: unknown,
  seasonId: string,
  playerId: string,
): Promise<QueryResult<{ id: string }>> {
  const response = await (client as SupabaseClient)
    .from("season_memberships")
    .select("id")
    .eq("season_id", seasonId)
    .eq("player_id", playerId)
    .eq("status", "active")
    .maybeSingle<{ id: string }>();
  return { data: response.data, error: response.error };
}

export async function insertNormalizedSubmission(
  client: unknown,
  row: SubmissionInsertRow,
): Promise<InsertResult> {
  const response = await (client as SupabaseClient)
    .from("submissions")
    .insert(row)
    .select("id,week_id,player_id,score,is_hidden,is_valid,source,detected_at,submitted_at,duplicate_key")
    .single();
  return { data: response.data, error: response.error };
}
