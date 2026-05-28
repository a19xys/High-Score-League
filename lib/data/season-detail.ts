import type { Season, SeasonStanding, WeekSummary } from "@/types";
import { getDataSource } from "./data-source";
import { getRealGames, mapGameRowToGame } from "./games";
import { getUserSeasonMemberships } from "./season-memberships";
import { getRealSeasonStandings } from "./season-standings";
import { getRealSeasons, mapSeasonRowToSeason } from "./seasons";
import { getRealWeeks, mapWeekRowToWeek } from "./weeks";
import {
  derivedStatusToVisibleWeekStatus,
  getDerivedWeekStatusFromRow,
} from "@/lib/week-status";
import {
  currentWeek,
  games as mockGames,
  getSeasonById,
  getSeasonWeeks,
  seasonStandings,
  seasons as mockSeasons,
} from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SeasonDetailData = {
  season: Season;
  weeks: WeekSummary[];
  currentWeekNumber?: number;
  standings: SeasonStanding[];
  hasRealStandings: boolean;
  officialResultCount: number;
  membershipStatus?: "joined" | "not_joined" | "login_required" | "closed";
  mode: "mock" | "supabase";
  warning: string | null;
  usingFallback: boolean;
};

function getMockSeason(identifier: string) {
  return (
    getSeasonById(identifier) ??
    mockSeasons.find((season) => season.slug === identifier)
  );
}

function getMockSeasonDetail(
  identifier: string,
  warning: string | null,
): SeasonDetailData | null {
  const season = getMockSeason(identifier);

  if (!season || season.status === "draft") {
    return null;
  }

  return {
    season,
    weeks: getSeasonWeeks(season.id),
    currentWeekNumber: currentWeek.number,
    standings: season.id === "s1" ? seasonStandings : [],
    hasRealStandings: false,
    officialResultCount: 0,
    membershipStatus:
      warning && season.status === "active" ? "login_required" : undefined,
    mode: "mock",
    warning,
    usingFallback: Boolean(warning),
  };
}

function isSecretGameTitle(title: string) {
  return title.trim().toLowerCase() === "juego secreto";
}

export async function getSeasonDetailData(
  identifier: string,
): Promise<SeasonDetailData | null> {
  if (getDataSource() !== "supabase") {
    return getMockSeasonDetail(identifier, null);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return getMockSeasonDetail(
      identifier,
      "Supabase no esta configurado. Mostrando fallback mock si existe.",
    );
  }

  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!userData.user) {
    return getMockSeasonDetail(
      identifier,
      "NEXT_PUBLIC_DATA_SOURCE=supabase, pero no hay sesion activa. Mostrando fallback mock si existe.",
    );
  }

  const [seasonsResult, weeksResult, gamesResult] = await Promise.all([
    getRealSeasons(),
    getRealWeeks(),
    getRealGames(),
  ]);

  const readError =
    seasonsResult.error ?? weeksResult.error ?? gamesResult.error ?? null;

  if (readError) {
    return getMockSeasonDetail(
      identifier,
      `${readError}. Mostrando fallback mock si existe.`,
    );
  }

  const seasonRow = seasonsResult.rows.find(
    (season) => season.id === identifier || season.slug === identifier,
  );

  if (!seasonRow) {
    return getMockSeasonDetail(
      identifier,
      "No se encontro una temporada real con ese id o slug. Mostrando fallback mock si existe.",
    );
  }

  if (seasonRow.status === "draft") {
    return null;
  }

  const realWeekRows = weeksResult.rows
    .filter((week) => week.season_id === seasonRow.id)
    .sort((a, b) => a.week_number - b.week_number);
  const gameRowsById = new Map(gamesResult.rows.map((game) => [game.id, game]));
  const fallbackGame = mockGames[0];
  const weekSummaries: WeekSummary[] = realWeekRows.map((weekRow) => {
    const gameRow = gameRowsById.get(weekRow.game_id);
    const game = gameRow ? mapGameRowToGame(gameRow) : fallbackGame;
    const derivedStatus = getDerivedWeekStatusFromRow(weekRow);
    const isSecret =
      derivedStatus === "draft" ||
      derivedStatus === "scheduled" ||
      isSecretGameTitle(game.title);
    const publicGame = isSecret
      ? {
          ...game,
          title: "Juego secreto",
          developer: "",
          genre: "",
          controlType: "",
          difficulty: "",
        }
      : game;
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
    ? `No se pudo leer la clasificacion real: ${standingsResult.error}.`
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
    usingFallback: false,
  };
}
