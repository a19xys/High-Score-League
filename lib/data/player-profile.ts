import type { SupabaseClient } from "@supabase/supabase-js";
import type { Game, Submission, Week } from "@/types";
import type { RealProfile, SubmissionRow } from "@/types/supabase";
import { resolveMediaUrl } from "@/lib/media/resolver";
import { getRealGames, mapGameRowToGame } from "./games";
import {
  getRealSubmissions,
  mapSubmissionRowToSubmission,
} from "./submissions";
import { getRealWeeklyResults } from "./weekly-results";
import { getRealWeeks, mapWeekRowToWeek } from "./weeks";

export type PlayerProfileStats = {
  victories: number;
  podiums: number;
  participations: number;
  officialResults: number;
};

export type PlayerProfileSubmission = Submission & {
  week?: Week;
  game?: Game;
};

export type PlayerBestScore = {
  week: Week;
  game?: Game;
  bestScore: number;
  uploads: number;
  latestAt: string;
};

export type PlayerOfficialResult = {
  id: string;
  week: Week;
  game?: Game;
  finalScore: number;
  rank: number;
  leaguePoints: number;
  createdAt: string;
};

export type PlayerCompetitiveProfile = {
  stats: PlayerProfileStats;
  ownerSubmissions: PlayerProfileSubmission[];
  bestScores: PlayerBestScore[];
  recentResults: PlayerOfficialResult[];
  hasDataWarning: boolean;
};

export type PublicPlayerProfile = Pick<
  RealProfile,
  | "id"
  | "username"
  | "initials"
  | "avatar_url"
  | "avatar_storage_path"
  | "bio"
  | "play_time_public"
  | "created_at"
>;

export type PublicPlayerProfileResult =
  | { status: "ok"; profile: PublicPlayerProfile }
  | { status: "not-found"; profile: null }
  | { status: "error"; profile: null };

export type PlayerProfileVisibility = "owner" | "public";

export function emptyPlayerProfileStats(): PlayerProfileStats {
  return {
    victories: 0,
    podiums: 0,
    participations: 0,
    officialResults: 0,
  };
}

export function emptyPlayerCompetitiveProfile(
  hasDataWarning = false,
): PlayerCompetitiveProfile {
  return {
    stats: emptyPlayerProfileStats(),
    ownerSubmissions: [],
    bestScores: [],
    recentResults: [],
    hasDataWarning,
  };
}

export async function getPublicPlayerProfile(
  supabase: SupabaseClient,
  username: string,
): Promise<PublicPlayerProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,initials,avatar_url,avatar_storage_path,bio,play_time_public,created_at")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    return { status: "error", profile: null };
  }

  if (!data) {
    return { status: "not-found", profile: null };
  }

  const profile = data as PublicPlayerProfile;
  return {
    status: "ok",
    profile: {
      ...profile,
      avatar_url: resolveMediaUrl({
        storagePath: profile.avatar_storage_path,
        legacyUrl: profile.avatar_url,
      }),
    },
  };
}

function isSubmissionPublic(row: SubmissionRow, week?: Week) {
  if (!row.is_hidden) {
    return true;
  }

  return week?.status === "closed" || week?.status === "published";
}

function buildBestScores(
  rows: SubmissionRow[],
  weeksById: Map<string, Week>,
  gamesById: Map<string, Game>,
): PlayerBestScore[] {
  const byWeek = new Map<
    string,
    {
      week: Week;
      game?: Game;
      bestScore: number;
      uploads: number;
      latestAt: string;
    }
  >();

  for (const row of rows) {
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
      game: week.gameId ? gamesById.get(week.gameId) : undefined,
      bestScore: Math.max(existing?.bestScore ?? 0, row.score),
      uploads: (existing?.uploads ?? 0) + 1,
      latestAt,
    });
  }

  return Array.from(byWeek.values()).sort((a, b) =>
    b.latestAt.localeCompare(a.latestAt),
  );
}

export async function getPlayerCompetitiveProfile(
  playerId: string,
  visibility: PlayerProfileVisibility,
): Promise<PlayerCompetitiveProfile> {
  const [submissionsResult, weeksResult, gamesResult, weeklyResultsResult] =
    await Promise.all([
      getRealSubmissions(undefined, playerId),
      getRealWeeks(),
      getRealGames(),
      getRealWeeklyResults(),
    ]);

  const hasDataWarning = Boolean(
    submissionsResult.error ||
      weeksResult.error ||
      gamesResult.error ||
      weeklyResultsResult.error,
  );
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
  const visibleSubmissionRows = submissionsResult.rows.filter((row) => {
    if (!row.is_valid) {
      return false;
    }

    return (
      visibility === "owner" ||
      isSubmissionPublic(row, weeksById.get(row.week_id))
    );
  });
  const ownerSubmissions =
    visibility === "owner"
      ? visibleSubmissionRows.map((row) => {
          const week = weeksById.get(row.week_id);
          const submission = mapSubmissionRowToSubmission(row, week);

          return {
            ...submission,
            game: week?.gameId ? gamesById.get(week.gameId) : undefined,
          };
        })
      : [];
  const playerResults = weeklyResultsResult.rows.filter(
    (result) => result.player_id === playerId,
  );
  const recentResults = playerResults
    .map((result): PlayerOfficialResult | null => {
      const week = weeksById.get(result.week_id);

      if (!week) {
        return null;
      }

      return {
        id: result.id,
        week,
        game: week.gameId ? gamesById.get(week.gameId) : undefined,
        finalScore: result.final_score,
        rank: result.rank,
        leaguePoints: Number(result.league_points ?? 0),
        createdAt: result.created_at,
      };
    })
    .filter((result): result is PlayerOfficialResult => Boolean(result))
    .sort((a, b) => {
      const aDate = a.week.endsAt || a.createdAt;
      const bDate = b.week.endsAt || b.createdAt;
      return bDate.localeCompare(aDate) || b.createdAt.localeCompare(a.createdAt);
    })
    .slice(0, 8);
  const participationWeekIds = new Set(
    visibleSubmissionRows.map((submission) => submission.week_id),
  );

  for (const result of playerResults) {
    participationWeekIds.add(result.week_id);
  }

  return {
    stats: {
      victories: playerResults.filter((result) => result.is_first_place).length,
      podiums: playerResults.filter(
        (result) =>
          result.is_first_place ||
          result.is_second_place ||
          result.is_third_place,
      ).length,
      participations: participationWeekIds.size,
      officialResults: playerResults.length,
    },
    ownerSubmissions,
    bestScores: buildBestScores(
      visibleSubmissionRows,
      weeksById,
      gamesById,
    ),
    recentResults,
    hasDataWarning,
  };
}
