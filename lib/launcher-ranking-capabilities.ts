export const LAUNCHER_RANKING_CONTRACT_VERSION = 1;
export const LAUNCHER_RANKING_BATCH_LIMIT = 100;
export const LAUNCHER_RANKING_ID_MAX_LENGTH = 128;

const identifierPattern = /^[A-Za-z0-9_-]+$/;

export type LauncherRankingRequest = {
  requestKey: string;
  weekId: string;
};

export type LauncherRankingCapability = {
  requestKey: string;
  status: "available" | "unavailable";
  url: string | null;
  reason: "public-week" | "not-found" | "not-public";
};

type RankingWeek = {
  id: string;
  season_id: string;
  game_id: string | null;
  week_number: number;
  status: string;
};

type RankingSeason = {
  id: string;
  status: string;
};

type PublicRankingInput = {
  week: RankingWeek | null;
  season: RankingSeason | null;
  derivedStatus: string | null;
  currentActiveWeekNumber?: number | null;
};

export function validLauncherRankingIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= LAUNCHER_RANKING_ID_MAX_LENGTH &&
    identifierPattern.test(value);
}

export function validateLauncherRankingRequest(payload: unknown):
  | { ok: true; requests: LauncherRankingRequest[] }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "El payload debe ser un objeto JSON." };
  }

  const record = payload as Record<string, unknown>;

  if (record.version !== LAUNCHER_RANKING_CONTRACT_VERSION) {
    return { ok: false, error: "Version de contrato no admitida." };
  }

  if (!Array.isArray(record.requests)) {
    return { ok: false, error: "requests debe ser un array." };
  }

  if (record.requests.length > LAUNCHER_RANKING_BATCH_LIMIT) {
    return { ok: false, error: `El batch no puede superar ${LAUNCHER_RANKING_BATCH_LIMIT} elementos.` };
  }

  const requests: LauncherRankingRequest[] = [];
  const requestKeys = new Set<string>();

  for (const item of record.requests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Cada request debe ser un objeto." };
    }

    const request = item as Record<string, unknown>;

    if (!validLauncherRankingIdentifier(request.requestKey) ||
        !validLauncherRankingIdentifier(request.weekId)) {
      return { ok: false, error: "requestKey y weekId deben ser identificadores validos." };
    }

    if (requestKeys.has(request.requestKey)) {
      return { ok: false, error: "requestKey no puede repetirse." };
    }

    requestKeys.add(request.requestKey);
    requests.push({
      requestKey: request.requestKey as string,
      weekId: request.weekId as string,
    });
  }

  return { ok: true, requests };
}

export function resolvePublicRankingCapability(input: PublicRankingInput) {
  const { week, season, derivedStatus, currentActiveWeekNumber = null } = input;

  if (!week) {
    return { status: "unavailable" as const, reason: "not-found" as const };
  }

  const futureActiveSeasonWeek = season?.status === "active" &&
    typeof currentActiveWeekNumber === "number" &&
    week.week_number > currentActiveWeekNumber &&
    week.status !== "published";
  const visibleStatus = ["active", "final_stretch", "closed", "published"].includes(
    String(derivedStatus || ""),
  );

  if (!season || season.status === "draft" || !week.game_id || futureActiveSeasonWeek || !visibleStatus) {
    return { status: "unavailable" as const, reason: "not-public" as const };
  }

  return { status: "available" as const, reason: "public-week" as const };
}

export function buildLauncherRankingResults(options: {
  requests: LauncherRankingRequest[];
  weeks: Array<RankingWeek & { derivedStatus: string }>;
  seasons: RankingSeason[];
  activeWeekNumbers?: Map<string, number>;
  origin: string;
}): LauncherRankingCapability[] {
  const weeksById = new Map(options.weeks.map((week) => [week.id, week]));
  const seasonsById = new Map(options.seasons.map((season) => [season.id, season]));
  const activeWeekNumbers = options.activeWeekNumbers || new Map<string, number>();

  return options.requests.map((request) => {
    const week = weeksById.get(request.weekId) || null;
    const resolved = resolvePublicRankingCapability({
      week,
      season: week ? seasonsById.get(week.season_id) || null : null,
      derivedStatus: week?.derivedStatus || null,
      currentActiveWeekNumber: week ? activeWeekNumbers.get(week.season_id) : null,
    });

    return {
      requestKey: request.requestKey,
      status: resolved.status,
      reason: resolved.reason,
      url: resolved.status === "available"
        ? new URL(`/weeks/${encodeURIComponent(request.weekId)}`, options.origin).toString()
        : null,
    };
  });
}
