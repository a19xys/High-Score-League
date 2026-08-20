import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLauncherPackDescriptor,
  isLauncherPackId,
  LAUNCHER_PACK_PRESIGN_TTL_SECONDS,
  validateLauncherPackCatalogRow,
} from "../launcher-pack-distribution.ts";
import type { LauncherPackStorage } from "../pack-storage/r2.ts";
import { resolvePublicWeekVisibility } from "../public-week-visibility.ts";
import { getDerivedWeekStatus } from "../week-status.ts";

const PACK_COLUMNS = "pack_id,week_id,size_bytes,sha256,object_key,status,published_at";
const WEEK_COLUMNS = "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at";

export type LauncherPackBearerClient = {
  auth: {
    getUser(): PromiseLike<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
};

type AdminClient = unknown;

type PackWeek = {
  id: string;
  season_id: string;
  game_id: string | null;
  week_number: number;
  status: string;
  public_start_at: string | null;
  public_freeze_at: string | null;
  final_deadline_at: string | null;
};

type PackSeason = {
  id: string;
  status: string;
};

type CatalogResult = {
  data: unknown;
  error: unknown;
};

type VisibilityResult =
  | { ok: true; available: boolean }
  | { ok: false };

export type LauncherPackDownloadResult = {
  status: number;
  body: object;
};

export type LauncherPackDownloadDependencies = {
  createBearerClient(request: NextRequest): LauncherPackBearerClient | null;
  createAdminClient(): AdminClient | null;
  createStorage(): LauncherPackStorage | null;
  checkActiveProfile(client: LauncherPackBearerClient, userId: string): Promise<{ active: boolean; error: string | null }>;
  loadCatalogPack(client: AdminClient, packId: string): Promise<CatalogResult>;
  loadWeekVisibility(client: AdminClient, weekId: string, now: Date): Promise<VisibilityResult>;
  now(): Date;
};

function errorResult(status: number, code: string, error: string): LauncherPackDownloadResult {
  return { status, body: { ok: false, code, error } };
}

function unavailablePack() {
  return errorResult(404, "PACK_NOT_AVAILABLE", "Este pack no está disponible.");
}

function packAuthUnavailable() {
  return errorResult(503, "PACK_AUTH_UNAVAILABLE", "La distribución de packs no está disponible.");
}

function packCatalogNotConfigured() {
  return errorResult(503, "PACK_CATALOG_NOT_CONFIGURED", "La distribución de packs no está disponible.");
}

export async function loadLauncherPackCatalogRow(
  client: AdminClient,
  packId: string,
): Promise<CatalogResult> {
  const result = await (client as SupabaseClient)
    .from("launcher_packs")
    .select(PACK_COLUMNS)
    .eq("pack_id", packId)
    .maybeSingle();

  return { data: result.data, error: result.error };
}

export async function loadLauncherPackWeekVisibility(
  client: AdminClient,
  weekId: string,
  now: Date,
): Promise<VisibilityResult> {
  const supabase = client as SupabaseClient;
  const weekResult = await supabase
    .from("weeks")
    .select(WEEK_COLUMNS)
    .eq("id", weekId)
    .maybeSingle<PackWeek>();

  if (weekResult.error) return { ok: false };
  if (!weekResult.data) return { ok: true, available: false };

  const [seasonResult, seasonWeeksResult] = await Promise.all([
    supabase
      .from("seasons")
      .select("id,status")
      .eq("id", weekResult.data.season_id)
      .maybeSingle<PackSeason>(),
    supabase
      .from("weeks")
      .select(WEEK_COLUMNS)
      .eq("season_id", weekResult.data.season_id),
  ]);

  if (seasonResult.error || seasonWeeksResult.error) return { ok: false };

  let currentActiveWeekNumber: number | null = null;
  for (const week of (seasonWeeksResult.data || []) as PackWeek[]) {
    const status = getDerivedWeekStatus(week, now);
    if (status !== "active" && status !== "final_stretch") continue;
    currentActiveWeekNumber = currentActiveWeekNumber === null
      ? week.week_number
      : Math.min(currentActiveWeekNumber, week.week_number);
  }

  const visibility = resolvePublicWeekVisibility({
    week: weekResult.data,
    season: seasonResult.data,
    derivedStatus: getDerivedWeekStatus(weekResult.data, now),
    currentActiveWeekNumber,
  });

  return { ok: true, available: visibility.status === "available" };
}

export async function resolveLauncherPackDownload(
  request: NextRequest,
  packId: string,
  dependencies: LauncherPackDownloadDependencies,
): Promise<LauncherPackDownloadResult> {
  if (!isLauncherPackId(packId)) {
    return errorResult(400, "INVALID_PACK_ID", "El identificador del pack no es válido.");
  }

  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) {
    return errorResult(401, "AUTH_REQUIRED", "Necesitas una sesión válida.");
  }

  let bearerClient: LauncherPackBearerClient | null;
  try {
    bearerClient = dependencies.createBearerClient(request);
  } catch {
    return packAuthUnavailable();
  }
  if (!bearerClient) {
    return packAuthUnavailable();
  }

  let authResult: Awaited<ReturnType<LauncherPackBearerClient["auth"]["getUser"]>>;
  try {
    authResult = await bearerClient.auth.getUser();
  } catch {
    return packAuthUnavailable();
  }
  if (authResult.error || !authResult.data.user) {
    return errorResult(401, "AUTH_REQUIRED", "Necesitas una sesión válida.");
  }
  const userId = authResult.data.user.id;

  let profileState: { active: boolean; error: string | null };
  try {
    profileState = await dependencies.checkActiveProfile(bearerClient, userId);
  } catch {
    return errorResult(503, "PROFILE_CHECK_FAILED", "No se pudo validar el perfil.");
  }
  if (profileState.error) {
    return errorResult(503, "PROFILE_CHECK_FAILED", "No se pudo validar el perfil.");
  }
  if (!profileState.active) {
    return errorResult(403, "ACTIVE_PROFILE_REQUIRED", "La cuenta no puede descargar packs.");
  }

  let adminClient: AdminClient | null;
  try {
    adminClient = dependencies.createAdminClient();
  } catch {
    return packCatalogNotConfigured();
  }
  if (!adminClient) {
    return packCatalogNotConfigured();
  }

  let catalogResult: CatalogResult;
  try {
    catalogResult = await dependencies.loadCatalogPack(adminClient, packId);
  } catch {
    return errorResult(503, "PACK_CATALOG_QUERY_FAILED", "La distribución de packs no está disponible.");
  }
  if (catalogResult.error) {
    return errorResult(503, "PACK_CATALOG_QUERY_FAILED", "La distribución de packs no está disponible.");
  }
  if (!catalogResult.data) return unavailablePack();

  const rawStatus = (catalogResult.data as Record<string, unknown>).status;
  if (rawStatus !== "published") return unavailablePack();

  const pack = validateLauncherPackCatalogRow(catalogResult.data, packId);
  if (!pack) {
    return errorResult(503, "PACK_CATALOG_INVALID", "La distribución de packs no está disponible.");
  }

  let visibility: VisibilityResult;
  try {
    visibility = await dependencies.loadWeekVisibility(adminClient, pack.week_id, dependencies.now());
  } catch {
    return errorResult(503, "PACK_CONTEXT_QUERY_FAILED", "La distribución de packs no está disponible.");
  }
  if (!visibility.ok) {
    return errorResult(503, "PACK_CONTEXT_QUERY_FAILED", "La distribución de packs no está disponible.");
  }
  if (!visibility.available) return unavailablePack();

  let storage: LauncherPackStorage | null;
  try {
    storage = dependencies.createStorage();
  } catch {
    storage = null;
  }
  if (!storage) {
    return errorResult(503, "PACK_STORAGE_NOT_CONFIGURED", "La distribución de packs no está disponible.");
  }

  let head;
  try {
    head = await storage.headObject(pack.object_key);
  } catch {
    return errorResult(503, "PACK_STORAGE_UNAVAILABLE", "La distribución de packs no está disponible.");
  }
  if (!head.ok) {
    return head.reason === "not-found"
      ? unavailablePack()
      : errorResult(503, "PACK_STORAGE_UNAVAILABLE", "La distribución de packs no está disponible.");
  }
  if (!Number.isSafeInteger(head.contentLength) || head.contentLength !== pack.size_bytes) {
    return errorResult(503, "PACK_SIZE_MISMATCH", "La distribución de packs no está disponible.");
  }

  let presigned;
  try {
    presigned = await storage.presignGet(pack.object_key, LAUNCHER_PACK_PRESIGN_TTL_SECONDS);
  } catch {
    return errorResult(503, "PACK_STORAGE_UNAVAILABLE", "La distribución de packs no está disponible.");
  }
  if (!presigned.ok) {
    return errorResult(503, "PACK_STORAGE_UNAVAILABLE", "La distribución de packs no está disponible.");
  }

  const descriptor = buildLauncherPackDescriptor({ pack, downloadUrl: presigned.url });
  if (!descriptor) {
    return errorResult(503, "PACK_DOWNLOAD_URL_INVALID", "La distribución de packs no está disponible.");
  }

  return { status: 200, body: descriptor };
}
