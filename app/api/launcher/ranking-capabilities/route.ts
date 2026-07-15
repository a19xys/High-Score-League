import { type NextRequest, NextResponse } from "next/server";
import {
  buildLauncherRankingResults,
  LAUNCHER_RANKING_CONTRACT_VERSION,
  validateLauncherRankingRequest,
} from "@/lib/launcher-ranking-capabilities";
import { getDerivedWeekStatus } from "@/lib/week-status";
import { loadLauncherRankingSource } from "@/lib/launcher-ranking-source";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SeasonRow, WeekRow } from "@/types/supabase";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;
const WEEK_COLUMNS = "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at";

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: responseHeaders });
}

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type RankingSourceWeek = Pick<
  WeekRow,
  | "id"
  | "season_id"
  | "game_id"
  | "week_number"
  | "status"
  | "public_start_at"
  | "public_freeze_at"
  | "final_deadline_at"
>;

type HandlerDependencies = {
  createAdminClient?: () => AdminClient | null;
  now?: () => Date;
};

async function handleLauncherRankingCapabilities(
  request: NextRequest,
  dependencies: HandlerDependencies = {},
) {
  let payload: unknown;
  const contentLength = Number(request.headers.get("content-length") || 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: "El payload es demasiado grande." }, 413);
  }

  try {
    const raw = await request.text();

    if (raw.length > MAX_REQUEST_BYTES) {
      return json({ ok: false, error: "El payload es demasiado grande." }, 413);
    }

    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "El payload debe ser JSON valido." }, 400);
  }

  const validated = validateLauncherRankingRequest(payload);

  if (!validated.ok) {
    return json({ ok: false, error: validated.error }, 400);
  }

  if (validated.requests.length === 0) {
    return json({
      version: LAUNCHER_RANKING_CONTRACT_VERSION,
      generatedAt: (dependencies.now?.() || new Date()).toISOString(),
      results: [],
    });
  }

  const supabase = (dependencies.createAdminClient || createSupabaseAdminClient)();

  if (!supabase) {
    return json({
      ok: false,
      code: "RANKING_SERVICE_NOT_CONFIGURED",
      error: "Servicio de rankings no configurado.",
    }, 503);
  }

  const weekIds = [...new Set(validated.requests.map((item) => item.weekId))];
  const source = await loadLauncherRankingSource<RankingSourceWeek, Pick<SeasonRow, "id" | "status">>({
    weekIds,
    loadRequestedWeeks: (ids) => supabase.from("weeks").select(WEEK_COLUMNS).in("id", ids),
    loadSeasons: (ids) => supabase.from("seasons").select("id,status").in("id", ids),
    loadSeasonWeeks: (ids) => supabase.from("weeks").select(WEEK_COLUMNS).in("season_id", ids),
    deriveStatus: (week) => getDerivedWeekStatus(week),
  });

  if (!source.ok) {
    return json({
      ok: false,
      code: source.code,
      error: "No se pudo comprobar la disponibilidad.",
    }, 503);
  }

  const weeks = source.requestedWeeks.map((week) => ({
    ...week,
    derivedStatus: getDerivedWeekStatus(week),
  }));
  const results = buildLauncherRankingResults({
    requests: validated.requests,
    weeks,
    seasons: source.seasons,
    activeWeekNumbers: source.activeWeekNumbers,
    origin: request.nextUrl.origin,
  });

  return json({
    version: LAUNCHER_RANKING_CONTRACT_VERSION,
    generatedAt: (dependencies.now?.() || new Date()).toISOString(),
    results,
  });
}

export async function POST(request: NextRequest) {
  return handleLauncherRankingCapabilities(request);
}
