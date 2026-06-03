import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Player, SeasonStanding } from "@/types";
import type {
  RealProfile,
  SeasonMembershipRow,
  WeeklyResultRow,
} from "@/types/supabase";
import { mapRealProfileToPlayer } from "./submissions";
import type { DataReadResult } from "./types";
import { getRealWeeklyResults } from "./weekly-results";
import { getRealWeeks } from "./weeks";

type MembershipWithProfile = SeasonMembershipRow & {
  profiles?: RealProfile | RealProfile[] | null;
};

type StandingAccumulator = {
  player: Player;
  totalPoints: number;
  firstPlaces: number;
  secondPlaces: number;
  thirdPlaces: number;
  weeksPlayed: number;
};

export type SeasonStandingsResult = DataReadResult<SeasonStanding> & {
  officialResultCount: number;
  memberCount: number;
  resultWeekCount: number;
};

const membershipColumns = `
  id,
  season_id,
  player_id,
  status,
  joined_at,
  created_at,
  profiles:player_id (
    id,
    username,
    initials,
    avatar_url,
    is_admin,
    created_at,
    updated_at
  )
`;

function normalizeProfile(profile: RealProfile | RealProfile[] | null | undefined) {
  return Array.isArray(profile) ? profile[0] : profile;
}

function emptyResult(error: string | null): SeasonStandingsResult {
  return {
    rows: [],
    source: "supabase",
    error,
    officialResultCount: 0,
    memberCount: 0,
    resultWeekCount: 0,
  };
}

function competitiveKey(standing: Pick<
  SeasonStanding,
  "totalPoints" | "firstPlaces" | "secondPlaces" | "thirdPlaces"
>) {
  return [
    standing.totalPoints,
    standing.firstPlaces,
    standing.secondPlaces,
    standing.thirdPlaces,
  ].join("|");
}

function rankStandings(
  standings: Array<Omit<SeasonStanding, "rank" | "positionChange">>,
  previousRanks?: Map<string, number>,
): SeasonStanding[] {
  const sorted = [...standings].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }

    if (b.firstPlaces !== a.firstPlaces) {
      return b.firstPlaces - a.firstPlaces;
    }

    if (b.secondPlaces !== a.secondPlaces) {
      return b.secondPlaces - a.secondPlaces;
    }

    if (b.thirdPlaces !== a.thirdPlaces) {
      return b.thirdPlaces - a.thirdPlaces;
    }

    return a.player.username.localeCompare(b.player.username);
  });

  const keyCounts = new Map<string, number>();
  for (const standing of sorted) {
    const key = competitiveKey(standing);
    keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  let currentRank = 0;
  let lastKey: string | null = null;

  return sorted.map((standing, index) => {
    const key = competitiveKey(standing);

    if (key !== lastKey) {
      currentRank = index + 1;
      lastKey = key;
    }

    const previousRank = previousRanks?.get(standing.player.id);

    return {
      ...standing,
      rank: currentRank,
      positionChange: previousRank ? previousRank - currentRank : 0,
      isTied: (keyCounts.get(key) ?? 0) > 1,
    };
  });
}

function buildStandings(
  memberships: MembershipWithProfile[],
  weeklyResults: WeeklyResultRow[],
  previousRanks?: Map<string, number>,
) {
  const byPlayer = new Map<string, StandingAccumulator>();

  for (const membership of memberships) {
    if (membership.status !== "active") {
      continue;
    }

    const profile = normalizeProfile(membership.profiles);

    if (!profile) {
      continue;
    }

    byPlayer.set(membership.player_id, {
      player: mapRealProfileToPlayer(profile),
      totalPoints: 0,
      firstPlaces: 0,
      secondPlaces: 0,
      thirdPlaces: 0,
      weeksPlayed: 0,
    });
  }

  for (const result of weeklyResults) {
    const profile = normalizeProfile(result.profiles);
    const existing = byPlayer.get(result.player_id);

    if (!existing && !profile) {
      continue;
    }

    const accumulator =
      existing ??
      {
        player: mapRealProfileToPlayer(profile as RealProfile),
        totalPoints: 0,
        firstPlaces: 0,
        secondPlaces: 0,
        thirdPlaces: 0,
        weeksPlayed: 0,
      };

    accumulator.totalPoints += Number(result.league_points ?? 0);
    accumulator.firstPlaces += result.is_first_place ? 1 : 0;
    accumulator.secondPlaces += result.is_second_place ? 1 : 0;
    accumulator.thirdPlaces += result.is_third_place ? 1 : 0;
    accumulator.weeksPlayed += 1;
    byPlayer.set(result.player_id, accumulator);
  }

  return rankStandings(
    Array.from(byPlayer.values()).map((standing) => ({
      player: standing.player,
      totalPoints: standing.totalPoints,
      firstPlaces: standing.firstPlaces,
      secondPlaces: standing.secondPlaces,
      thirdPlaces: standing.thirdPlaces,
      weeksPlayed: standing.weeksPlayed,
    })),
    previousRanks,
  );
}

function ranksByPlayer(standings: SeasonStanding[]) {
  return new Map(standings.map((standing) => [standing.player.id, standing.rank]));
}

export async function getRealSeasonStandings(
  seasonId: string,
): Promise<SeasonStandingsResult> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return emptyResult("Supabase no esta configurado.");
  }

  const [weeksResult, weeklyResultsResult, membershipsResult] = await Promise.all([
    getRealWeeks(),
    getRealWeeklyResults(),
    supabase
      .from("season_memberships")
      .select(membershipColumns)
      .eq("season_id", seasonId)
      .eq("status", "active"),
  ]);

  if (weeksResult.error) {
    return emptyResult(weeksResult.error);
  }

  if (weeklyResultsResult.error) {
    return emptyResult(weeklyResultsResult.error);
  }

  if (membershipsResult.error) {
    return emptyResult(membershipsResult.error.message);
  }

  const seasonWeeks = weeksResult.rows
    .filter((week) => week.season_id === seasonId)
    .sort((a, b) => a.week_number - b.week_number);
  const weekIds = new Set(seasonWeeks.map((week) => week.id));
  const resultRows = weeklyResultsResult.rows.filter((result) =>
    weekIds.has(result.week_id),
  );
  const resultWeekIds = new Set(resultRows.map((result) => result.week_id));
  const resultWeeks = seasonWeeks.filter((week) => resultWeekIds.has(week.id));
  const latestResultWeek = resultWeeks.at(-1);
  const previousRows =
    resultWeeks.length > 1 && latestResultWeek
      ? resultRows.filter((result) => result.week_id !== latestResultWeek.id)
      : [];
  const memberships = (membershipsResult.data ?? []) as MembershipWithProfile[];
  const previousRanks =
    previousRows.length > 0
      ? ranksByPlayer(buildStandings(memberships, previousRows))
      : undefined;
  const standings = buildStandings(memberships, resultRows, previousRanks);

  return {
    rows: standings,
    source: "supabase",
    error: null,
    officialResultCount: resultRows.length,
    memberCount: memberships.length,
    resultWeekCount: resultWeekIds.size,
  };
}

