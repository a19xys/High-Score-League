import type { WeekSummary } from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  currentWeek,
  getWeekSummaries,
  games as mockGames,
} from "@/lib/mock-data";
import { getDataSource } from "./data-source";
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
  mode: "mock" | "supabase";
  warning: string | null;
  usingFallback: boolean;
  disableWeekLinks: boolean;
};

function fallbackToMock(warning: string | null): WeekPageData {
  return {
    weeks: getWeekSummaries(),
    currentWeekNumber: currentWeek.number,
    mode: "mock",
    warning,
    usingFallback: Boolean(warning),
    disableWeekLinks: false,
  };
}

function isSecretGameTitle(title: string) {
  return title.trim().toLowerCase() === "juego secreto";
}

export async function getWeekPageData(): Promise<WeekPageData> {
  if (getDataSource() !== "supabase") {
    return fallbackToMock(null);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!userData.user) {
    return fallbackToMock(
      "NEXT_PUBLIC_DATA_SOURCE=supabase, pero no hay sesion activa. Mostrando fallback mock porque RLS puede ocultar weeks.",
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
    return fallbackToMock(
      `${readError}. Mostrando fallback mock para no romper el archivo semanal.`,
    );
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
  const fallbackGame = mockGames[0];
  const weekSummaries = weeksResult.rows
    .filter((week) => seasonsById.has(week.season_id))
    .map((week) => {
      const seasonRow = seasonsById.get(week.season_id);
      const gameRow = gamesById.get(week.game_id);
      const rawGame = gameRow ? mapGameRowToGame(gameRow) : fallbackGame;
      const derivedStatus = getDerivedWeekStatusFromRow(week);
      const isSecret =
        derivedStatus === "draft" ||
        derivedStatus === "scheduled" ||
        isSecretGameTitle(rawGame.title);
      const game = isSecret
        ? {
            ...rawGame,
            title: "Juego secreto",
            developer: "",
            genre: "",
            controlType: "",
            difficulty: "",
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
    usingFallback: false,
    disableWeekLinks: false,
  };
}
