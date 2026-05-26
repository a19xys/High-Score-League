import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SeasonRow } from "@/types/supabase";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

type JoinRouteContext = {
  params: Promise<{
    seasonId: string;
  }>;
};

export async function POST(_request: NextRequest, { params }: JoinRouteContext) {
  const { seasonId } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return jsonError("Supabase no está configurado.", 500);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return jsonError("Necesitas iniciar sesión para unirte a la temporada.", 401);
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id,status")
    .eq("id", seasonId)
    .maybeSingle<Pick<SeasonRow, "id" | "status">>();

  if (seasonError) {
    return jsonError("No se pudo validar la temporada.", 500);
  }

  if (!season) {
    return jsonError("La temporada no existe o no es visible.", 404);
  }

  if (season.status !== "active") {
    return jsonError("Solo puedes unirte a temporadas activas.", 409);
  }

  const { data: existing } = await supabase
    .from("season_memberships")
    .select("id,status")
    .eq("season_id", season.id)
    .eq("player_id", userData.user.id)
    .maybeSingle<{ id: string; status: "active" | "left" }>();

  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyJoined: true,
      membership: existing,
    });
  }

  const { data: membership, error: insertError } = await supabase
    .from("season_memberships")
    .insert({
      season_id: season.id,
      player_id: userData.user.id,
      status: "active",
    })
    .select("id,season_id,player_id,status,joined_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, alreadyJoined: true });
    }

    return jsonError("No se pudo crear la membresía.", 500);
  }

  return NextResponse.json(
    { ok: true, alreadyJoined: false, membership },
    { status: 201 },
  );
}
