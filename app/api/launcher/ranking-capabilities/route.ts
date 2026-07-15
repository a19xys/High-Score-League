import { type NextRequest, NextResponse } from "next/server";
import {
  buildLauncherRankingResults,
  LAUNCHER_RANKING_CONTRACT_VERSION,
  validateLauncherRankingRequest,
} from "@/lib/launcher-ranking-capabilities";
import { getDerivedWeekStatusFromRow } from "@/lib/week-status";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SeasonRow, WeekRow } from "@/types/supabase";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;

const responseHeaders = {
  "Cache-Control": "no-store, max-age=0",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: responseHeaders });
}

export async function POST(request: NextRequest) {
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
      generatedAt: new Date().toISOString(),
      results: [],
    });
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return json({ ok: false, error: "Servicio de rankings no configurado." }, 503);
  }

  const weekIds = [...new Set(validated.requests.map((item) => item.weekId))];
  const { data: requestedWeeks, error: requestedWeeksError } = await supabase
    .from("weeks")
    .select("id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary")
    .in("id", weekIds);

  if (requestedWeeksError) {
    return json({ ok: false, error: "No se pudo comprobar la disponibilidad." }, 503);
  }

  const seasonIds = [...new Set(((requestedWeeks || []) as WeekRow[]).map((week) => week.season_id))];
  const [{ data: seasons, error: seasonsError }, { data: seasonWeeks, error: seasonWeeksError }] = await Promise.all([
    seasonIds.length > 0
      ? supabase.from("seasons").select("id,status").in("id", seasonIds)
      : Promise.resolve({ data: [], error: null }),
    seasonIds.length > 0
      ? supabase
        .from("weeks")
        .select("id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary")
        .in("season_id", seasonIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (seasonsError || seasonWeeksError) {
    return json({ ok: false, error: "No se pudo comprobar la disponibilidad." }, 503);
  }

  const allSeasonWeeks = (seasonWeeks || []) as WeekRow[];
  const activeWeekNumbers = new Map<string, number>();

  for (const week of allSeasonWeeks) {
    const status = getDerivedWeekStatusFromRow(week);

    if (!["active", "final_stretch"].includes(status)) {
      continue;
    }

    const current = activeWeekNumbers.get(week.season_id);
    activeWeekNumbers.set(week.season_id, current === undefined ? week.week_number : Math.min(current, week.week_number));
  }

  const weeks = ((requestedWeeks || []) as WeekRow[]).map((week) => ({
    ...week,
    derivedStatus: getDerivedWeekStatusFromRow(week),
  }));
  const results = buildLauncherRankingResults({
    requests: validated.requests,
    weeks,
    seasons: (seasons || []) as Pick<SeasonRow, "id" | "status">[],
    activeWeekNumbers,
    origin: request.nextUrl.origin,
  });

  return json({
    version: LAUNCHER_RANKING_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    results,
  });
}
