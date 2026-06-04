import type { WeekSummary } from "@/types";
import { getRealGames, mapGameRowToGame } from "./games";
import { getRealSeasons, mapSeasonRowToSeason } from "./seasons";
import { getRealWeeks, mapWeekRowToWeek } from "./weeks";
import {
  derivedStatusToVisibleWeekStatus,
  getDerivedWeekStatusFromRow,
} from "@/lib/week-status";

export type WeekPageData = {
  weeks: WeekSummary[];
  currentWeekNumber?: number;
  mode: "supabase";
  warning: string | null;
  disableWeekLinks: boolean;
};

function isSecretGameTitle(title: string) {
  return title.trim().toLowerCase() === "juego secreto";
}

export async function getWeekPageData(): Promise<WeekPageData> {
  const [seasonsResult, weeksResult, gamesResult] = await Promise.all([
    getRealSeasons(),
    getRealWeeks(),
    getRealGames(),
  ]);
  const readError =
    seasonsResult.error ?? weeksResult.error ?? gamesResult.error ?? null;

  if (readError) {
    return {
      weeks: [],
      mode: "supabase",
      warning: readError,
      disableWeekLinks: false,
    };
  }

  const visibleSeasons = seasonsResult.rows.filter(
    (season) => season.status !== "draft",
  );
  const seasonsById = new Map(visibleSeasons.map((season) => [season.id, season]));
  const gamesById = new Map(gamesResult.rows.map((game) => [game.id, game]));
  const weekCounts = weeksResult.rows.reduce<Record<string, number>>((counts, week) => {
    if (seasonsById.has(week.season_id)) {
      counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    }

    return counts;
  }, {});
  const weekSummaries = weeksResult.rows
    .filter((week) => seasonsById.has(week.season_id))
    .map((week) => {
      const seasonRow = seasonsById.get(week.season_id);
      const gameRow = gamesById.get(week.game_id);
      const rawGame = gameRow
        ? mapGameRowToGame(gameRow)
        : {
            id: week.game_id,
            title: "Juego no disponible",
            slug: "juego-no-disponible",
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
      const derivedStatus = getDerivedWeekStatusFromRow(week);
      const isSecret =
        derivedStatus === "draft" ||
        derivedStatus === "scheduled" ||
        isSecretGameTitle(rawGame.title);
      const game = isSecret
        ? {
            ...rawGame,
            title: "Juego secreto",
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
      const mappedWeek = mapWeekRowToWeek(week);

      return {
        week: {
          ...mappedWeek,
          status: derivedStatusToVisibleWeekStatus(derivedStatus),
        },
        season: mapSeasonRowToSeason(
          seasonRow as NonNullable<typeof seasonRow>,
          weekCounts[week.season_id] ?? 0,
        ),
        game,
        winner: undefined,
        leaderboard: [],
      };
    })
    .sort((a, b) => b.week.startsAt.localeCompare(a.week.startsAt));
  const activeWeek = weeksResult.rows.find((week) => {
    const status = getDerivedWeekStatusFromRow(week);
    return status === "active" || status === "final_stretch";
  });

  return {
    weeks: weekSummaries,
    currentWeekNumber: activeWeek?.week_number,
    mode: "supabase",
    warning: null,
    disableWeekLinks: false,
  };
}

