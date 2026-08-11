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
import { getRealSeasons } from "./seasons";
import {
  buildPlayerBestScores,
  type PlayerBestScore,
} from "@/lib/profile-best-scores";

export type { PlayerBestScore } from "@/lib/profile-best-scores";

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

export type PlayerCompetitiveProfile = {
  stats: PlayerProfileStats;
  ownerSubmissions: PlayerProfileSubmission[];
  bestScores: PlayerBestScore[];
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
  | "presence_public"
  | "anonymized_at"
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
    hasDataWarning,
  };
}

export async function getPublicPlayerProfile(
  supabase: SupabaseClient,
  username: string,
): Promise<PublicPlayerProfileResult> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,initials,avatar_url,avatar_storage_path,bio,play_time_public,presence_public,anonymized_at,created_at")
    .eq("username", username)
    .is("anonymized_at", null)
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

export async function getPlayerCompetitiveProfile(
  playerId: string,
  visibility: PlayerProfileVisibility,
): Promise<PlayerCompetitiveProfile> {
  const [
    submissionsResult,
    weeksResult,
    gamesResult,
    seasonsResult,
    weeklyResultsResult,
  ] =
    await Promise.all([
      getRealSubmissions(undefined, playerId),
      getRealWeeks(),
      getRealGames(),
      getRealSeasons(),
      getRealWeeklyResults(),
    ]);

  const hasDataWarning = Boolean(
    submissionsResult.error ||
      weeksResult.error ||
      gamesResult.error ||
      seasonsResult.error ||
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
  const seasonNamesById = new Map(
    seasonsResult.rows.map((season) => [season.id, season.name] as const),
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
  const rankByWeekId = new Map(
    playerResults.map((result) => [result.week_id, result.rank] as const),
  );
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
    bestScores: buildPlayerBestScores({
      rows: visibleSubmissionRows,
      weeksById,
      gamesById,
      rankByWeekId,
      seasonNamesById,
    }),
    hasDataWarning,
  };
}
