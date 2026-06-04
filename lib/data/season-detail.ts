import type { Season, SeasonStanding, WeekSummary } from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRealGames, mapGameRowToGame } from "./games";
import { getUserSeasonMemberships } from "./season-memberships";
import { getRealSeasonStandings } from "./season-standings";
import { getRealSeasons, mapSeasonRowToSeason } from "./seasons";
import { getRealWeeks, mapWeekRowToWeek } from "./weeks";
import {
  derivedStatusToVisibleWeekStatus,
  getDerivedWeekStatusFromRow,
} from "@/lib/week-status";

export type SeasonDetailData = {
  season: Season;
  weeks: WeekSummary[];
  currentWeekNumber?: number;
  standings: SeasonStanding[];
  hasRealStandings: boolean;
  officialResultCount: number;
  membershipStatus?: "joined" | "not_joined" | "login_required" | "closed";
  mode: "supabase";
  warning: string | null;
};

export async function getSeasonDetailData(
  identifier: string,
): Promise<SeasonDetailData | null> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!userData.user) {
    return null;
  }

  const [seasonsResult, weeksResult, gamesResult] = await Promise.all([
    getRealSeasons(),
    getRealWeeks(),
    getRealGames(),
  ]);

  const readError =
    seasonsResult.error ?? weeksResult.error ?? gamesResult.error ?? null;

  if (readError) {
    return null;
  }

  const seasonRow = seasonsResult.rows.find(
    (season) => season.id === identifier || season.slug === identifier,
  );

  if (!seasonRow || seasonRow.status === "draft") {
    return null;
  }

  const realWeekRows = weeksResult.rows
    .filter((week) => week.season_id === seasonRow.id)
    .sort((a, b) => a.week_number - b.week_number);
  const gameRowsById = new Map(gamesResult.rows.map((game) => [game.id, game]));
  const weekSummaries: WeekSummary[] = realWeekRows.map((weekRow) => {
    const gameRow = weekRow.game_id ? gameRowsById.get(weekRow.game_id) : null;
    const rawGame = gameRow
      ? mapGameRowToGame(gameRow)
      : {
          id: weekRow.game_id ?? "unassigned",
          title: "Por anunciar",
          slug: "por-anunciar",
          developers: [],
          publishers: [],
          perspectives: [],
          themes: [],
          genres: [],
          taxonomyTags: [],
          developer: "",
          publisher: "",
          genre: "",
          imageAlt: "Juego no disponible",
        };
    const derivedStatus = getDerivedWeekStatusFromRow(weekRow);
    const isSecret =
      derivedStatus === "draft" ||
      derivedStatus === "scheduled" ||
      weekRow.game_id === null;
    const publicGame = isSecret
      ? {
          ...rawGame,
          title: "Por anunciar",
          developers: [],
          publishers: [],
          perspectives: [],
          themes: [],
          genres: [],
          taxonomyTags: [],
          developer: "",
          publisher: "",
          genre: "",
        }
      : rawGame;
    const mappedWeek = mapWeekRowToWeek(weekRow);

    return {
      week: {
        ...mappedWeek,
        status: derivedStatusToVisibleWeekStatus(derivedStatus),
      },
      season: mapSeasonRowToSeason(seasonRow, realWeekRows.length),
      game: publicGame,
      winner: undefined,
      leaderboard: [],
    };
  });
  const activeWeek = realWeekRows.find((week) => {
    const status = getDerivedWeekStatusFromRow(week);
    return status === "active" || status === "final_stretch";
  });
  const [memberships, standingsResult] = await Promise.all([
    getUserSeasonMemberships(supabase, userData.user.id, [seasonRow.id]),
    getRealSeasonStandings(seasonRow.id),
  ]);
  const standingsWarning = standingsResult.error
    ? `No se pudo leer la clasificación real: ${standingsResult.error}.`
    : null;

  return {
    season: mapSeasonRowToSeason(seasonRow, realWeekRows.length),
    weeks: weekSummaries,
    currentWeekNumber: activeWeek?.week_number,
    standings: standingsResult.rows,
    hasRealStandings: standingsResult.officialResultCount > 0,
    officialResultCount: standingsResult.officialResultCount,
    membershipStatus:
      seasonRow.status === "active"
        ? memberships.get(seasonRow.id)?.status === "active"
          ? "joined"
          : "not_joined"
        : "closed",
    mode: "supabase",
    warning: standingsWarning,
  };
}

