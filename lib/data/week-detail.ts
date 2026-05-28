import type {
  Game,
  LeaderboardEntry,
  Season,
  Submission,
  Week,
  Player,
  WeekBenchmark,
  WeeklyResult,
} from "@/types";
import {
  currentSeason,
  currentWeek,
  getCurrentGame,
  getGameById,
  getSeasonById,
  getSubmissionsForWeek,
  getWeekById,
  getWeeklyLeaderboard,
  weeks as mockWeeks,
} from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDataSource } from "./data-source";
import { getRealGames, mapGameRowToGame } from "./games";
import { getRealSeasons, mapSeasonRowToSeason } from "./seasons";
import {
  buildLeaderboardFromSubmissions,
  getRealSubmissions,
  mapSubmissionRowToSubmission,
} from "./submissions";
import {
  getRealWeekBenchmarks,
  mapWeekBenchmarkRowToBenchmark,
} from "./week-benchmarks";
import { getRealWeeklyResults, mapWeeklyResultRowToWeeklyResult } from "./weekly-results";
import { getRealWeeks, mapWeekRowToWeek } from "./weeks";

type WeekSubmission = Submission & {
  player?: Player;
  week?: Week;
  game?: Game;
};

export type WeekDetailData = {
  season: Season;
  week: Week;
  game: Game;
  leaderboard: LeaderboardEntry[];
  benchmarks: WeekBenchmark[];
  submissions: WeekSubmission[];
  weeklyResults: WeeklyResult[];
  mode: "mock" | "supabase";
  warning: string | null;
  usingFallback: boolean;
  isSecret: boolean;
  hideDownloads: boolean;
  leaderboardPending: boolean;
  submissionsPending: boolean;
};

export type ActiveWeekResult =
  | { status: "ok"; data: WeekDetailData }
  | { status: "empty"; message: string; warning?: string | null };

type ActiveWeekOptions = {
  fallbackToMock?: boolean;
};

function secretGame(): Game {
  return {
    id: "secret",
    title: "Juego secreto",
    slug: "juego-secreto",
    developer: "",
    genre: "",
    controlType: "",
    difficulty: "",
    imageAlt: "Juego secreto",
  };
}

function mockWeekDetail(weekId: string, warning: string | null): WeekDetailData | null {
  const week = getWeekById(weekId);

  if (!week) {
    return null;
  }

  const season = getSeasonById(week.seasonId);
  const game = getGameById(week.gameId);

  if (!season || !game) {
    return null;
  }

  const isFutureActiveSeasonWeek =
    season.status === "active" &&
    week.number > currentWeek.number &&
    week.status !== "published";

  return {
    season,
    week,
    game: isFutureActiveSeasonWeek ? secretGame() : game,
    leaderboard: isFutureActiveSeasonWeek ? [] : getWeeklyLeaderboard(week.id),
    benchmarks: [],
    submissions: isFutureActiveSeasonWeek ? [] : getSubmissionsForWeek(week.id),
    weeklyResults: [],
    mode: "mock",
    warning,
    usingFallback: Boolean(warning),
    isSecret: isFutureActiveSeasonWeek,
    hideDownloads: isFutureActiveSeasonWeek,
    leaderboardPending: false,
    submissionsPending: false,
  };
}

function mockCurrentWeekDetail(warning: string | null): WeekDetailData {
  return {
    season: currentSeason,
    week: currentWeek,
    game: getCurrentGame(),
    leaderboard: getWeeklyLeaderboard(currentWeek.id),
    benchmarks: [],
    submissions: getSubmissionsForWeek(currentWeek.id),
    weeklyResults: [],
    mode: "mock",
    warning,
    usingFallback: Boolean(warning),
    isSecret: false,
    hideDownloads: false,
    leaderboardPending: false,
    submissionsPending: false,
  };
}

function isSecretGameTitle(title: string) {
  return title.trim().toLowerCase() === "juego secreto";
}

async function readRealWeekContext() {
  const [seasonsResult, weeksResult, gamesResult] = await Promise.all([
    getRealSeasons(),
    getRealWeeks(),
    getRealGames(),
  ]);
  const error = seasonsResult.error ?? weeksResult.error ?? gamesResult.error ?? null;

  return {
    seasons: seasonsResult.rows,
    weeks: weeksResult.rows,
    games: gamesResult.rows,
    error,
  };
}

async function requireSession() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  return Boolean(userData.user);
}

async function buildRealWeekDetail(
  weekId: string,
  context: Awaited<ReturnType<typeof readRealWeekContext>>,
  warning: string | null,
): Promise<WeekDetailData | null> {
  const weekRow = context.weeks.find((week) => week.id === weekId);

  if (!weekRow) {
    return null;
  }

  const seasonRow = context.seasons.find((season) => season.id === weekRow.season_id);

  if (!seasonRow || seasonRow.status === "draft") {
    return null;
  }

  const activeWeek = context.weeks
    .filter((week) => week.status === "active" && week.season_id === seasonRow.id)
    .sort((a, b) => a.week_number - b.week_number)[0];
  const gameRow = context.games.find((game) => game.id === weekRow.game_id);
  const rawGame = gameRow ? mapGameRowToGame(gameRow) : secretGame();
  const isFuture =
    seasonRow.status === "active" &&
    activeWeek &&
    weekRow.week_number > activeWeek.week_number &&
    weekRow.status !== "published";
  const isSecret =
    weekRow.status === "draft" || Boolean(isFuture) || isSecretGameTitle(rawGame.title);
  const week = mapWeekRowToWeek(weekRow);
  const rules = isSecret
    ? ["El juego, reglas y descargas permanecerán ocultos hasta que se active la semana."]
    : week.rules;
  const submissionsResult = isSecret ? null : await getRealSubmissions(weekRow.id);
  const benchmarksResult = isSecret ? null : await getRealWeekBenchmarks(weekRow.id);
  const weeklyResultsResult =
    !isSecret && weekRow.status === "published"
      ? await getRealWeeklyResults(weekRow.id)
      : null;
  const warningParts = [
    warning,
    submissionsResult?.error
      ? `No se pudieron cargar submissions reales: ${submissionsResult.error}.`
      : null,
    benchmarksResult?.error
      ? `No se pudieron cargar benchmarks de semana: ${benchmarksResult.error}.`
      : null,
    weeklyResultsResult?.error
      ? `No se pudieron cargar resultados oficiales: ${weeklyResultsResult.error}.`
      : null,
  ].filter(Boolean);
  const realSubmissionRows = submissionsResult?.rows ?? [];
  const realBenchmarkRows = benchmarksResult?.rows ?? [];
  const realWeeklyResultRows = weeklyResultsResult?.rows ?? [];

  return {
    season: mapSeasonRowToSeason(
      seasonRow,
      context.weeks.filter((row) => row.season_id === seasonRow.id).length,
    ),
    week: {
      ...week,
      rules,
    },
    game: isSecret ? secretGame() : rawGame,
    leaderboard: isSecret
      ? []
      : buildLeaderboardFromSubmissions(realSubmissionRows, week.status),
    benchmarks: isSecret
      ? []
      : realBenchmarkRows.map(mapWeekBenchmarkRowToBenchmark),
    submissions: isSecret
      ? []
      : realSubmissionRows.map((row) => mapSubmissionRowToSubmission(row, week)),
    weeklyResults: realWeeklyResultRows.map(mapWeeklyResultRowToWeeklyResult),
    mode: "supabase",
    warning: warningParts.length > 0 ? warningParts.join(" ") : null,
    usingFallback: Boolean(warning),
    isSecret,
    hideDownloads: isSecret,
    leaderboardPending: false,
    submissionsPending: false,
  };
}

export async function getWeekDetailData(weekId: string): Promise<WeekDetailData | null> {
  if (getDataSource() !== "supabase") {
    return mockWeekDetail(weekId, null);
  }

  if (!(await requireSession())) {
    return mockWeekDetail(
      weekId,
      "NEXT_PUBLIC_DATA_SOURCE=supabase, pero no hay sesión activa. Mostrando fallback mock si existe.",
    );
  }

  const context = await readRealWeekContext();

  if (context.error) {
    return mockWeekDetail(
      weekId,
      `${context.error}. Mostrando fallback mock si existe.`,
    );
  }

  return (await buildRealWeekDetail(weekId, context, null)) ?? mockWeekDetail(
    weekId,
    "No se encontró una semana real con ese id. Mostrando fallback mock si existe.",
  );
}

export async function getActiveWeekDetailData(
  options: ActiveWeekOptions = {},
): Promise<ActiveWeekResult> {
  const fallbackToMock = options.fallbackToMock ?? true;

  if (getDataSource() !== "supabase") {
    return { status: "ok", data: mockCurrentWeekDetail(null) };
  }

  if (!(await requireSession())) {
    if (!fallbackToMock) {
      return {
        status: "empty",
        message:
          "Inicia sesión para leer la semana activa real. RLS puede ocultar los datos sin sesión.",
      };
    }

    return {
      status: "ok",
      data: mockCurrentWeekDetail(
        "NEXT_PUBLIC_DATA_SOURCE=supabase, pero no hay sesión activa. Mostrando fallback mock porque RLS puede ocultar la semana activa.",
      ),
    };
  }

  const context = await readRealWeekContext();

  if (context.error) {
    if (!fallbackToMock) {
      return {
        status: "empty",
        message: "No se pudieron cargar los datos reales de la semana activa.",
        warning: context.error,
      };
    }

    return {
      status: "ok",
      data: mockCurrentWeekDetail(`${context.error}. Mostrando fallback mock.`),
    };
  }

  const activeWeeks = context.weeks
    .filter((week) => week.status === "active")
    .sort((a, b) => {
      const dateOrder = (a.public_start_at ?? "").localeCompare(b.public_start_at ?? "");
      return dateOrder || a.week_number - b.week_number;
    });

  if (activeWeeks.length === 0) {
    return {
      status: "empty",
      message: "No hay ninguna semana activa configurada en Supabase.",
    };
  }

  const warning =
    activeWeeks.length > 1
      ? `Hay ${activeWeeks.length} semanas activas en Supabase. Se muestra la primera por fecha de inicio.`
      : null;
  const detail = await buildRealWeekDetail(activeWeeks[0].id, context, warning);

  if (!detail) {
    return {
      status: "empty",
      message: "La semana activa existe, pero su temporada o juego no son visibles.",
      warning,
    };
  }

  return { status: "ok", data: detail };
}

export function getMockWeekStaticParams() {
  return mockWeeks.map((week) => ({ weekId: week.id }));
}
