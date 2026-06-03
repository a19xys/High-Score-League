import {
  ProfileDashboard,
  type ProfileAuthData,
  type ProfileBestScore,
  type ProfileStats,
} from "@/components/profile-dashboard";
import { ensureProfileForCurrentUser } from "@/lib/auth/ensure-profile";
import { getAdminCurrentWeek } from "@/lib/data/admin-weeks";
import { getRealGames, mapGameRowToGame } from "@/lib/data/games";
import {
  getRealSubmissions,
  mapSubmissionRowToSubmission,
} from "@/lib/data/submissions";
import { getRealWeeklyResults } from "@/lib/data/weekly-results";
import { getRealWeeks, mapWeekRowToWeek } from "@/lib/data/weeks";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Game, Submission, Week } from "@/types";
import type { RealProfile, SubmissionRow } from "@/types/supabase";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Perfil | High Score League",
};

type ProfileSubmission = Submission & {
  week?: Week;
  game?: Game;
};

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function emptyStats(): ProfileStats {
  return {
    victories: 0,
    podiums: 0,
    participations: 0,
    officialResults: 0,
  };
}

function buildBestScores(
  submissionRows: SubmissionRow[],
  weeksById: Map<string, Week>,
  gamesById: Map<string, Game>,
): ProfileBestScore[] {
  const byWeek = new Map<
    string,
    { week: Week; game?: Game; bestScore: number; uploads: number; latestAt: string }
  >();

  for (const row of submissionRows) {
    if (!row.is_valid) {
      continue;
    }

    const week = weeksById.get(row.week_id);

    if (!week) {
      continue;
    }

    const existing = byWeek.get(row.week_id);
    const latestAt =
      existing && existing.latestAt > row.submitted_at
        ? existing.latestAt
        : row.submitted_at;

    byWeek.set(row.week_id, {
      week,
      game: gamesById.get(week.gameId),
      bestScore: Math.max(existing?.bestScore ?? 0, row.score),
      uploads: (existing?.uploads ?? 0) + 1,
      latestAt,
    });
  }

  return Array.from(byWeek.values()).sort((a, b) =>
    b.latestAt.localeCompare(a.latestAt),
  );
}

async function getAdminCenterData(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  profile: RealProfile | null,
) {
  if (!profile?.is_admin) {
    return { isAdmin: false };
  }

  const currentWeek = await getAdminCurrentWeek(supabase);

  return {
    isAdmin: true,
    currentWeekId: currentWeek.summary?.week.id,
    currentWeekLabel: currentWeek.summary
      ? `${currentWeek.summary.season.name} · Semana ${currentWeek.summary.week.number}`
      : undefined,
    activeWeekCount: currentWeek.activeCount,
    error: currentWeek.error,
  };
}

async function getSignedInProfileData(
  userId: string,
): Promise<{
  stats: ProfileStats;
  recentSubmissions: ProfileSubmission[];
  bestScores: ProfileBestScore[];
}> {
  const [submissionsResult, weeksResult, gamesResult, weeklyResultsResult] =
    await Promise.all([
      getRealSubmissions(undefined, userId),
      getRealWeeks(),
      getRealGames(),
      getRealWeeklyResults(),
    ]);

  if (submissionsResult.error || weeksResult.error || gamesResult.error) {
    return {
      stats: emptyStats(),
      recentSubmissions: [],
      bestScores: [],
    };
  }

  const weeksById = new Map(
    weeksResult.rows.map((weekRow) => {
      const week = mapWeekRowToWeek(weekRow);
      return [week.id, week] as const;
    }),
  );
  const gamesById = new Map(
    gamesResult.rows.map((gameRow) => {
      const game = mapGameRowToGame(gameRow);
      return [game.id, game] as const;
    }),
  );
  const submissionRows = submissionsResult.rows;
  const recentSubmissions = submissionRows.slice(0, 8).map((row) => {
    const week = weeksById.get(row.week_id);
    const submission = mapSubmissionRowToSubmission(row, week);

    return {
      ...submission,
      game: week ? gamesById.get(week.gameId) : undefined,
    };
  });
  const userWeeklyResults = weeklyResultsResult.rows.filter(
    (result) => result.player_id === userId,
  );
  const validSubmissionWeekIds = new Set(
    submissionRows
      .filter((submission) => submission.is_valid)
      .map((submission) => submission.week_id),
  );

  for (const result of userWeeklyResults) {
    validSubmissionWeekIds.add(result.week_id);
  }

  return {
    stats: {
      victories: userWeeklyResults.filter((result) => result.is_first_place).length,
      podiums: userWeeklyResults.filter(
        (result) =>
          result.is_first_place ||
          result.is_second_place ||
          result.is_third_place,
      ).length,
      participations: validSubmissionWeekIds.size,
      officialResults: userWeeklyResults.length,
    },
    recentSubmissions,
    bestScores: buildBestScores(submissionRows, weeksById, gamesById),
  };
}

export default async function ProfilePage() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <ProfileDashboard
        adminCenter={{ isAdmin: false }}
        auth={{ status: "not-configured" }}
        bestScores={[]}
        recentSubmissions={[]}
        stats={emptyStats()}
      />
    );
  }

  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <ProfileDashboard
        adminCenter={{ isAdmin: false }}
        auth={{ status: "signed-out" }}
        bestScores={[]}
        recentSubmissions={[]}
        stats={emptyStats()}
      />
    );
  }

  const profileResult = await ensureProfileForCurrentUser(supabase);
  const profile =
    profileResult.status === "ok" ? profileResult.profile : null;
  const [adminCenter, realData] = await Promise.all([
    getAdminCenterData(supabase, profile),
    getSignedInProfileData(userData.user.id),
  ]);
  const auth: ProfileAuthData = {
    status: "signed-in",
    email: userData.user.email ?? "sin email",
    profile,
    profileError:
      profileResult.status === "needs-input" ? profileResult.error : null,
    metadataUsername: metadataString(userData.user.user_metadata.username).trim(),
    metadataInitials: metadataString(userData.user.user_metadata.initials).trim(),
  };

  return (
    <ProfileDashboard
      adminCenter={adminCenter}
      auth={auth}
      bestScores={realData.bestScores}
      recentSubmissions={realData.recentSubmissions}
      stats={realData.stats}
    />
  );
}
