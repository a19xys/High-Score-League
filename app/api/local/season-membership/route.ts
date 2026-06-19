import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { SeasonMembershipRow, WeekRow } from "@/types/supabase";

export const dynamic = "force-dynamic";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(statusValue: string, message: string, status = 400) {
  return jsonResponse(
    {
      ok: false,
      status: statusValue,
      message,
    },
    status,
  );
}

function createAuthenticatedClient(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const env = getSupabaseEnv();

  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

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

export async function GET(request: NextRequest) {
  const weekId = request.nextUrl.searchParams.get("weekId")?.trim();

  if (!weekId) {
    return jsonError("invalid_week", "weekId es obligatorio.", 400);
  }

  const supabase = createAuthenticatedClient(request);

  if (!supabase) {
    return jsonError("unauthenticated", "Necesitas una sesion valida.", 401);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("unauthenticated", "Necesitas una sesion valida.", 401);
  }

  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select("id,season_id,week_number,status")
    .eq("id", weekId)
    .maybeSingle<Pick<WeekRow, "id" | "season_id" | "week_number" | "status">>();

  if (weekError) {
    return jsonError("error", "No se pudo comprobar la semana.", 500);
  }

  if (!week) {
    return jsonError("invalid_week", "No se encontro la semana del pack.", 404);
  }

  const { data: membership, error: membershipError } = await supabase
    .from("season_memberships")
    .select("id,season_id,player_id,status,joined_at,created_at")
    .eq("season_id", week.season_id)
    .eq("player_id", userData.user.id)
    .eq("status", "active")
    .maybeSingle<SeasonMembershipRow>();

  if (membershipError) {
    return jsonError("error", "No se pudo comprobar la participacion.", 500);
  }

  if (!membership) {
    return jsonResponse({
      ok: true,
      status: "not_member",
      weekId: week.id,
      seasonId: week.season_id,
      joinUrl: `/seasons/${week.season_id}`,
      message: "No participas en esta temporada.",
    });
  }

  return jsonResponse({
    ok: true,
    status: "member",
    weekId: week.id,
    seasonId: week.season_id,
    joinUrl: `/seasons/${week.season_id}`,
    message: "Participas en esta temporada.",
  });
}
