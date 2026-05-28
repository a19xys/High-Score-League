import { type NextRequest, NextResponse } from "next/server";
import {
  calculateWeeklyResultsForWeek,
  type CalculatedWeeklyResult,
  replaceWeeklyResultsForWeek,
} from "@/lib/weekly-results/calculate";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSynchronizedWeekStatus } from "@/lib/week-status";

type WeeklyResultsRouteContext = {
  params: Promise<{
    weekId: string;
  }>;
};

type Payload = {
  dryRun?: unknown;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function serializeResult(result: CalculatedWeeklyResult) {
  return {
    weekId: result.week_id,
    playerId: result.player_id,
    finalScore: result.final_score,
    rank: result.rank,
    leaguePoints: result.league_points,
    isFirstPlace: result.is_first_place,
    isSecondPlace: result.is_second_place,
    isThirdPlace: result.is_third_place,
    submittedAt: result.submitted_at,
    username: result.username,
  };
}

export async function POST(
  request: NextRequest,
  { params }: WeeklyResultsRouteContext,
) {
  const { weekId } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas iniciar sesión.", 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle<{ is_admin: boolean }>();

  if (profileError) {
    return jsonError("No se pudo validar el perfil admin.", 500);
  }

  if (!profile?.is_admin) {
    return jsonError("Necesitas permisos de admin.", 403);
  }

  let payload: Payload = {};

  try {
    payload = (await request.json()) as Payload;
  } catch {
    payload = {};
  }

  if (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") {
    return jsonError("dryRun debe ser booleano.");
  }

  const dryRun = payload.dryRun ?? true;
  const calculation = await calculateWeeklyResultsForWeek(supabase, weekId);

  if (!calculation.ok) {
    return jsonError(calculation.error, calculation.status);
  }

  const synchronizedStatus = getSynchronizedWeekStatus(calculation.week);

  if (!dryRun && !["closed", "published"].includes(synchronizedStatus)) {
    return jsonError(
      "Solo se pueden generar resultados oficiales para semanas closed o published.",
      409,
    );
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      weekId,
      weekStatus: synchronizedStatus,
      cutoffAt: calculation.cutoffAt,
      memberCount: calculation.memberCount,
      results: calculation.results.map(serializeResult),
    });
  }

  const writeResult = await replaceWeeklyResultsForWeek(
    supabase,
    weekId,
    calculation.results,
  );

  if (!writeResult.ok) {
    return jsonError(writeResult.error, writeResult.status);
  }

  await supabase
    .from("weeks")
    .update({ status: "published" })
    .eq("id", weekId);

  return NextResponse.json({
    ok: true,
    dryRun: false,
    weekId,
    weekStatus: "published",
    cutoffAt: calculation.cutoffAt,
    memberCount: calculation.memberCount,
    results: calculation.results.map(serializeResult),
    savedRows: writeResult.rows,
  });
}
