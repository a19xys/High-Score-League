import type {
  Game,
  LeaderboardEntry,
  Player,
  Season,
  Submission,
  Week,
  WeekBenchmark,
  WeeklyResult,
} from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
import {
  derivedStatusToVisibleWeekStatus,
  getDerivedWeekStatusFromRow,
  getWeekStatusHelp,
} from "@/lib/week-status";

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
  mode: "supabase";
  warning: string | null;
  isSecret: boolean;
  hideDownloads: boolean;
  leaderboardPending: boolean;
  submissionsPending: boolean;
  statusHelp: string | null;
};

export type ActiveWeekResult =
  | { status: "ok"; data: WeekDetailData }
  | { status: "empty"; message: string; warning?: string | null };

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

function unavailableGame(gameId: string): Game {
  return {
    id: gameId,
    title: "Juego no disponible",
    slug: "juego-no-disponible",
    developer: "",
    genre: "",
    controlType: "",
    difficulty: "",
    imageAlt: "Juego no disponible",
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
    .filter((week) => {
      const status = getDerivedWeekStatusFromRow(week);
      return (
        week.season_id === seasonRow.id &&
        (status === "active" || status === "final_stretch")
      );
    })
    .sort((a, b) => a.week_number - b.week_number)[0];
  const gameRow = context.games.find((game) => game.id === weekRow.game_id);
  const rawGame = gameRow ? mapGameRowToGame(gameRow) : unavailableGame(weekRow.game_id);
  const preliminaryDerivedStatus = getDerivedWeekStatusFromRow(weekRow);
  const isFuture =
    seasonRow.status === "active" &&
    activeWeek &&
    weekRow.week_number > activeWeek.week_number &&
    weekRow.status !== "published";
  const isSecret =
    preliminaryDerivedStatus === "draft" ||
    preliminaryDerivedStatus === "scheduled" ||
    Boolean(isFuture) ||
    isSecretGameTitle(rawGame.title);
  const week = mapWeekRowToWeek(weekRow);
  const rules = isSecret
    ? ["El juego, instrucciones y descargas permanecerán ocultos hasta que se active la semana."]
    : week.rules;
  const submissionsResult = isSecret ? null : await getRealSubmissions(weekRow.id);
  const benchmarksResult = isSecret ? null : await getRealWeekBenchmarks(weekRow.id);
  const weeklyResultsResult = isSecret ? null : await getRealWeeklyResults(weekRow.id);
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
  const derivedStatus = getDerivedWeekStatusFromRow(
    weekRow,
    new Date(),
    realWeeklyResultRows.length > 0,
  );
  const visibleWeek = {
    ...week,
    status: derivedStatusToVisibleWeekStatus(derivedStatus),
    rules,
  };

  return {
    season: mapSeasonRowToSeason(
      seasonRow,
      context.weeks.filter((row) => row.season_id === seasonRow.id).length,
    ),
    week: visibleWeek,
    game: isSecret ? secretGame() : rawGame,
    leaderboard: isSecret
      ? []
      : buildLeaderboardFromSubmissions(realSubmissionRows, visibleWeek.status),
    benchmarks: isSecret
      ? []
      : realBenchmarkRows.map(mapWeekBenchmarkRowToBenchmark),
    submissions: isSecret
      ? []
      : realSubmissionRows.map((row) => mapSubmissionRowToSubmission(row, visibleWeek)),
    weeklyResults: realWeeklyResultRows.map(mapWeeklyResultRowToWeeklyResult),
    mode: "supabase",
    warning: warningParts.length > 0 ? warningParts.join(" ") : null,
    isSecret,
    hideDownloads: isSecret,
    leaderboardPending: false,
    submissionsPending: false,
    statusHelp: getWeekStatusHelp(isSecret ? preliminaryDerivedStatus : derivedStatus),
  };
}

export async function getWeekDetailData(weekId: string): Promise<WeekDetailData | null> {
  if (!(await requireSession())) {
    return null;
  }

  const context = await readRealWeekContext();

  if (context.error) {
    return {
      season: {
        id: "error",
        name: "Temporada no disponible",
        slug: "temporada-no-disponible",
        status: "draft",
        startsAt: "",
        endsAt: "",
        weekCount: 0,
      },
      week: {
        id: weekId,
        seasonId: "error",
        gameId: "error",
        number: 0,
        startsAt: "",
        endsAt: "",
        status: "draft",
        rules: [],
      },
      game: unavailableGame("error"),
      leaderboard: [],
      benchmarks: [],
      submissions: [],
      weeklyResults: [],
      mode: "supabase",
      warning: context.error,
      isSecret: false,
      hideDownloads: true,
      leaderboardPending: true,
      submissionsPending: true,
      statusHelp: null,
    };
  }

  return buildRealWeekDetail(weekId, context, null);
}

export async function getActiveWeekDetailData(): Promise<ActiveWeekResult> {
  if (!(await requireSession())) {
    return {
      status: "empty",
      message: "Inicia sesión para leer la semana activa.",
    };
  }

  const context = await readRealWeekContext();

  if (context.error) {
    return {
      status: "empty",
      message: "No se pudieron cargar los datos reales de la semana activa.",
      warning: context.error,
    };
  }

  const activeWeeks = context.weeks
    .filter((week) => {
      const status = getDerivedWeekStatusFromRow(week);
      return status === "active" || status === "final_stretch";
    })
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

