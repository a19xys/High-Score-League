export const LAUNCHER_WEEK_CONTRACT_VERSION = 1;
export const LAUNCHER_WEEK_BATCH_LIMIT = 100;
export const LAUNCHER_WEEK_ID_MAX_LENGTH = 128;

const identifierPattern = /^[A-Za-z0-9_-]+$/;
const databaseWeekIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LauncherWeekRequest = { requestKey: string; weekId: string };
export type LauncherPublicWeekState = "inactive" | "active" | "closed" | "unlinked";

type WeekInput = {
  id: string;
  season_id: string;
  game_id: string | null;
  status: string;
  public_start_at: string | null;
  public_freeze_at: string | null;
  final_deadline_at: string | null;
  derivedStatus: string;
};

type SeasonInput = { id: string; status: string };

export function validLauncherWeekIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= LAUNCHER_WEEK_ID_MAX_LENGTH
    && identifierPattern.test(value);
}

export function validLauncherWeekDatabaseId(value: unknown): value is string {
  return typeof value === "string" && databaseWeekIdPattern.test(value);
}

export function validateLauncherWeekRequest(payload: unknown):
  | { ok: true; requests: LauncherWeekRequest[] }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "El payload debe ser un objeto JSON." };
  }
  const record = payload as Record<string, unknown>;
  if (record.version !== LAUNCHER_WEEK_CONTRACT_VERSION) {
    return { ok: false, error: "Version de contrato no admitida." };
  }
  if (!Array.isArray(record.requests)) return { ok: false, error: "requests debe ser un array." };
  if (record.requests.length > LAUNCHER_WEEK_BATCH_LIMIT) {
    return { ok: false, error: `El batch no puede superar ${LAUNCHER_WEEK_BATCH_LIMIT} elementos.` };
  }
  const requests: LauncherWeekRequest[] = [];
  const keys = new Set<string>();
  for (const item of record.requests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "Cada request debe ser un objeto." };
    const request = item as Record<string, unknown>;
    if (!validLauncherWeekIdentifier(request.requestKey) || !validLauncherWeekIdentifier(request.weekId)) {
      return { ok: false, error: "requestKey y weekId deben ser identificadores validos." };
    }
    if (keys.has(request.requestKey)) return { ok: false, error: "requestKey no puede repetirse." };
    keys.add(request.requestKey);
    requests.push({ requestKey: request.requestKey, weekId: request.weekId });
  }
  return { ok: true, requests };
}

export function resolvePublicWeekCapability(
  week: WeekInput | null,
  season: SeasonInput | null,
) {
  if (!week) return { publicState: "unlinked" as const, reason: "not-found" as const };
  if (!week.game_id || !season) return { publicState: "unlinked" as const, reason: "not-linked" as const };
  if (season.status === "completed") return { publicState: "closed" as const, reason: "week-closed" as const };
  if (season.status !== "active") return { publicState: "inactive" as const, reason: "week-inactive" as const };
  if (["active", "final_stretch"].includes(week.derivedStatus)) {
    return { publicState: "active" as const, reason: "week-active" as const };
  }
  if (["closed", "published"].includes(week.derivedStatus)) {
    return { publicState: "closed" as const, reason: "week-closed" as const };
  }
  return { publicState: "inactive" as const, reason: "week-inactive" as const };
}

export function buildLauncherWeekResults(options: {
  requests: LauncherWeekRequest[];
  weeks: WeekInput[];
  seasons: SeasonInput[];
}) {
  const weeks = new Map(options.weeks.map((week) => [week.id, week]));
  const seasons = new Map(options.seasons.map((season) => [season.id, season]));
  return options.requests.map((request) => {
    const week = weeks.get(request.weekId) || null;
    const resolved = resolvePublicWeekCapability(week, week ? seasons.get(week.season_id) || null : null);
    return {
      requestKey: request.requestKey,
      weekId: request.weekId,
      seasonId: week?.season_id || null,
      derivedStatus: week?.derivedStatus || null,
      publicState: resolved.publicState,
      canPlayCompetition: resolved.publicState === "active",
      publicStartAt: week?.public_start_at || null,
      publicFreezeAt: week?.public_freeze_at || null,
      finalDeadlineAt: week?.final_deadline_at || null,
      rawStatus: week?.status || null,
      seasonStatus: week ? seasons.get(week.season_id)?.status || null : null,
      reason: resolved.reason,
    };
  });
}
