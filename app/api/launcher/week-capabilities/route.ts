import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import {
  buildPublishedPackMap,
  buildLauncherWeekResults,
  launcherWeekIsPubliclyRevealable,
  LAUNCHER_WEEK_CONTRACT_VERSION,
  validateLauncherWeekRequest,
  validLauncherWeekDatabaseId,
} from "@/lib/launcher-week-capabilities";
import { getLauncherDeploymentFingerprint, getLauncherDeploymentHeaders } from "@/lib/launcher-deployment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDerivedWeekStatus } from "@/lib/week-status";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 32 * 1024;
const WEEK_COLUMNS = "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", ...getLauncherDeploymentHeaders() },
  });
}

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type HandlerDependencies = { createAdminClient?: () => AdminClient | null; now?: () => Date };

async function handleLauncherWeekCapabilities(
  request: NextRequest,
  dependencies: HandlerDependencies = {},
) {
  const deployment = getLauncherDeploymentFingerprint();
  const requestId = randomUUID();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: "El payload es demasiado grande." }, 413);
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return json({ ok: false, error: "El payload es demasiado grande." }, 413);
    payload = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "El payload debe ser JSON valido." }, 400);
  }
  const validated = validateLauncherWeekRequest(payload);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

  const now = dependencies.now?.() || new Date();
  if (validated.requests.length === 0) {
    return json({
      version: LAUNCHER_WEEK_CONTRACT_VERSION,
      build: deployment.build,
      environment: deployment.environment,
      generatedAt: now.toISOString(),
      results: [],
    });
  }
  const supabase = (dependencies.createAdminClient || createSupabaseAdminClient)();
  if (!supabase) return json({ ok: false, code: "WEEK_SERVICE_NOT_CONFIGURED", error: "Servicio de semanas no configurado." }, 503);

  const weekIds = [...new Set(validated.requests.map((item) => item.weekId))].filter(validLauncherWeekDatabaseId);
  const weekQuery = weekIds.length > 0
    ? await supabase.from("weeks").select(WEEK_COLUMNS).in("id", weekIds)
    : { data: [], error: null };
  if (weekQuery.error) {
    console.error(JSON.stringify({ event: "launcher-week-query-failed", requestId, stage: "weeks", timestamp: new Date().toISOString() }));
    return json({ ok: false, code: "WEEK_QUERY_FAILED", error: "No se pudo comprobar la competicion." }, 503);
  }
  const rawWeeks = weekQuery.data || [];
  const seasonIds = [...new Set(rawWeeks.map((week) => week.season_id).filter(Boolean))];
  const seasonQuery = seasonIds.length > 0
    ? await supabase.from("seasons").select("id,status").in("id", seasonIds)
    : { data: [], error: null };
  if (seasonQuery.error) {
    console.error(JSON.stringify({ event: "launcher-week-query-failed", requestId, stage: "seasons", timestamp: new Date().toISOString() }));
    return json({ ok: false, code: "WEEK_CONTEXT_QUERY_FAILED", error: "No se pudo comprobar la competicion." }, 503);
  }
  const resultQuery = weekIds.length > 0
    ? await supabase.from("weekly_results").select("week_id").in("week_id", weekIds)
    : { data: [], error: null };
  if (resultQuery.error) {
    console.error(JSON.stringify({ event: "launcher-week-query-failed", requestId, stage: "weekly-results", timestamp: new Date().toISOString() }));
    return json({ ok: false, code: "WEEK_RESULTS_QUERY_FAILED", error: "No se pudo comprobar la competicion." }, 503);
  }
  const officialResultWeekIds = new Set((resultQuery.data || []).map((result) => result.week_id));
  const seasonWeekQuery = seasonIds.length > 0
    ? await supabase.from("weeks").select(WEEK_COLUMNS).in("season_id", seasonIds)
    : { data: [], error: null };
  if (seasonWeekQuery.error) {
    console.error(JSON.stringify({ event: "launcher-week-query-failed", requestId, stage: "season-weeks", timestamp: new Date().toISOString() }));
    return json({ ok: false, code: "WEEK_VISIBILITY_QUERY_FAILED", error: "No se pudo comprobar la competicion." }, 503);
  }
  const currentActiveWeekNumbers = new Map<string, number>();
  for (const week of seasonWeekQuery.data || []) {
    const derived = getDerivedWeekStatus(week, now);
    if (!['active', 'final_stretch'].includes(derived)) continue;
    const previous = currentActiveWeekNumbers.get(week.season_id);
    currentActiveWeekNumbers.set(
      week.season_id,
      previous === undefined ? week.week_number : Math.min(previous, week.week_number),
    );
  }
  const seasonsById = new Map((seasonQuery.data || []).map((season) => [season.id, season]));
  const revealableWeekIds = new Set(rawWeeks.filter((week) => launcherWeekIsPubliclyRevealable(
    week,
    seasonsById.get(week.season_id) || null,
    {
      currentActiveWeekNumber: currentActiveWeekNumbers.get(week.season_id) ?? null,
      hasOfficialResults: officialResultWeekIds.has(week.id),
      now,
    },
  )).map((week) => week.id));
  const packQuery = revealableWeekIds.size > 0
    ? await supabase.from("launcher_packs").select("week_id,pack_id").in("week_id", [...revealableWeekIds]).eq("status", "published")
    : { data: [], error: null };
  if (packQuery.error) {
    console.error(JSON.stringify({ event: "launcher-week-query-failed", requestId, stage: "launcher-packs", timestamp: new Date().toISOString() }));
    return json({ ok: false, code: "WEEK_PACK_QUERY_FAILED", error: "No se pudo comprobar la competicion." }, 503);
  }
  const publishedPackIds = buildPublishedPackMap(packQuery.data || [], revealableWeekIds);
  if (!publishedPackIds) {
    console.error(JSON.stringify({ event: "launcher-week-query-failed", requestId, stage: "launcher-packs-invalid", timestamp: new Date().toISOString() }));
    return json({ ok: false, code: "WEEK_PACK_QUERY_FAILED", error: "No se pudo comprobar la competicion." }, 503);
  }
  return json({
    version: LAUNCHER_WEEK_CONTRACT_VERSION,
    build: deployment.build,
    environment: deployment.environment,
    generatedAt: now.toISOString(),
    results: buildLauncherWeekResults({
      officialResultWeekIds,
      currentActiveWeekNumbers,
      now,
      publishedPackIds,
      requests: validated.requests,
      seasons: seasonQuery.data || [],
      weeks: rawWeeks,
    }),
  });
}

export async function POST(request: NextRequest) {
  return handleLauncherWeekCapabilities(request);
}
