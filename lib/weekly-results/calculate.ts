import type { SupabaseClient } from "@supabase/supabase-js";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RealProfile, WeekRow } from "@/types/supabase";

type SupabaseServerClient =
  | NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>
  | SupabaseClient;

type MembershipWithProfile = {
  player_id: string;
  joined_at: string;
  profiles?: RealProfile | RealProfile[] | null;
};

type SubmissionForResult = {
  id: string;
  player_id: string;
  score: number;
  submitted_at: string;
};

export type CalculatedWeeklyResult = {
  week_id: string;
  player_id: string;
  final_score: number;
  rank: number;
  league_points: number;
  is_first_place: boolean;
  is_second_place: boolean;
  is_third_place: boolean;
  submitted_at: string;
  username: string;
};

export type WeeklyResultsCalculation =
  | {
      ok: true;
      week: Pick<
        WeekRow,
        | "id"
        | "season_id"
        | "status"
        | "final_deadline_at"
        | "reveal_at"
        | "public_freeze_at"
        | "public_start_at"
      >;
      cutoffAt: string;
      memberCount: number;
      results: CalculatedWeeklyResult[];
    }
  | { ok: false; status: number; error: string };

function normalizeProfile(profile: RealProfile | RealProfile[] | null | undefined) {
  return Array.isArray(profile) ? profile[0] : profile;
}

export function calculateWeeklyLeaguePoints(memberCount: number, rank: number) {
  if (memberCount <= 0 || rank <= 0 || rank > memberCount) {
    return 0;
  }

  if (memberCount === 1) {
    return rank === 1 ? 1 : 0;
  }

  if (memberCount === 2) {
    return rank === 1 ? 4 : 1;
  }

  if (rank === 1) {
    return memberCount + 3;
  }

  if (rank === 2) {
    return memberCount;
  }

  if (rank === 3) {
    return memberCount - 2;
  }

  return Math.max(memberCount - rank + 1, 0);
}

function resolveWeekCutoff(
  week: Pick<
    WeekRow,
    "final_deadline_at" | "reveal_at" | "public_freeze_at" | "public_start_at"
  >,
) {
  return (
    week.final_deadline_at ??
    week.reveal_at ??
    week.public_freeze_at ??
    week.public_start_at ??
    new Date().toISOString()
  );
}

export async function calculateWeeklyResultsForWeek(
  supabase: SupabaseServerClient,
  weekId: string,
): Promise<WeeklyResultsCalculation> {
  const { data: week, error: weekError } = await supabase
    .from("weeks")
    .select(
      "id,season_id,status,final_deadline_at,reveal_at,public_freeze_at,public_start_at",
    )
    .eq("id", weekId)
    .maybeSingle<
      Pick<
        WeekRow,
        | "id"
        | "season_id"
        | "status"
        | "final_deadline_at"
        | "reveal_at"
        | "public_freeze_at"
        | "public_start_at"
      >
    >();

  if (weekError) {
    return { ok: false, status: 500, error: "No se pudo leer la semana." };
  }

  if (!week) {
    return { ok: false, status: 404, error: "La semana no existe." };
  }

  const cutoffAt = resolveWeekCutoff(week);
  const { data: memberships, error: membershipsError } = await supabase
    .from("season_memberships")
    .select(
      "player_id,joined_at,profiles:player_id(id,username,initials,avatar_url,is_admin)",
    )
    .eq("season_id", week.season_id)
    .eq("status", "active")
    .lte("joined_at", cutoffAt);

  if (membershipsError) {
    return {
      ok: false,
      status: 500,
      error: "No se pudieron leer las membresías activas.",
    };
  }

  const activeMemberships = (memberships ?? []) as MembershipWithProfile[];
  const memberCount = activeMemberships.length;

  if (memberCount === 0) {
    return {
      ok: false,
      status: 409,
      error: "No hay miembros elegibles para esta semana.",
    };
  }

  const memberIds = new Set(
    activeMemberships.map((membership) => membership.player_id),
  );
  const profileByPlayerId = new Map(
    activeMemberships.map((membership) => [
      membership.player_id,
      normalizeProfile(membership.profiles),
    ]),
  );
  const { data: submissions, error: submissionsError } = await supabase
    .from("submissions")
    .select("id,player_id,score,submitted_at")
    .eq("week_id", week.id)
    .eq("is_valid", true);

  if (submissionsError) {
    return {
      ok: false,
      status: 500,
      error: "No se pudieron leer las submissions de la semana.",
    };
  }

  const bestByPlayer = new Map<string, SubmissionForResult>();

  for (const submission of (submissions ?? []) as SubmissionForResult[]) {
    if (!memberIds.has(submission.player_id)) {
      continue;
    }

    const currentBest = bestByPlayer.get(submission.player_id);

    if (
      !currentBest ||
      submission.score > currentBest.score ||
      (submission.score === currentBest.score &&
        submission.submitted_at < currentBest.submitted_at)
    ) {
      bestByPlayer.set(submission.player_id, submission);
    }
  }

  const ranked = Array.from(bestByPlayer.values()).sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const submittedOrder = a.submitted_at.localeCompare(b.submitted_at);

    if (submittedOrder !== 0) {
      return submittedOrder;
    }

    const aProfile = profileByPlayerId.get(a.player_id);
    const bProfile = profileByPlayerId.get(b.player_id);
    const usernameOrder = (aProfile?.username ?? "").localeCompare(
      bProfile?.username ?? "",
    );

    return usernameOrder || a.player_id.localeCompare(b.player_id);
  });

  return {
      ok: true,
      week,
      cutoffAt,
      memberCount,
    results: ranked.map((submission, index) => {
      const rank = index + 1;
      const profile = profileByPlayerId.get(submission.player_id);

      return {
        week_id: week.id,
        player_id: submission.player_id,
        final_score: submission.score,
        rank,
        league_points: calculateWeeklyLeaguePoints(memberCount, rank),
        is_first_place: rank === 1,
        is_second_place: rank === 2,
        is_third_place: rank === 3,
        submitted_at: submission.submitted_at,
        username: profile?.username ?? submission.player_id,
      };
    }),
  };
}

export async function replaceWeeklyResultsForWeek(
  supabase: SupabaseServerClient,
  weekId: string,
  results: CalculatedWeeklyResult[],
) {
  const { error: deleteError } = await supabase
    .from("weekly_results")
    .delete()
    .eq("week_id", weekId);

  if (deleteError) {
    return {
      ok: false as const,
      status: 500,
      error: "No se pudieron borrar resultados anteriores.",
    };
  }

  if (results.length === 0) {
    return { ok: true as const, rows: [] };
  }

  const { data, error: insertError } = await supabase
    .from("weekly_results")
    .insert(
      results.map((result) => ({
        week_id: result.week_id,
        player_id: result.player_id,
        final_score: result.final_score,
        rank: result.rank,
        league_points: result.league_points,
        is_first_place: result.is_first_place,
        is_second_place: result.is_second_place,
        is_third_place: result.is_third_place,
      })),
    )
    .select(
      "id,week_id,player_id,final_score,rank,league_points,is_first_place,is_second_place,is_third_place,created_at",
    );

  if (insertError) {
    return {
      ok: false as const,
      status: 500,
      error: "No se pudieron insertar resultados oficiales.",
    };
  }

  return { ok: true as const, rows: data ?? [] };
}
