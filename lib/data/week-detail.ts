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
  getHiddenSubmissionActivity,
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
import type { SubmissionRow } from "@/types/supabase";

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

function unannouncedGame(): Game {
  return {
    id: "unassigned",
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
    imageAlt: "Juego por anunciar",
  };
}

function unavailableGame(gameId: string): Game {
  return {
    id: gameId,
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

async function getCurrentUserId() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  return userData.user?.id ?? null;
}

function mergeSubmissionRows(
  submissionRows: SubmissionRow[],
  activityRows: SubmissionRow[],
) {
  const byId = new Map<string, SubmissionRow>();

  for (const row of activityRows) {
    byId.set(row.id, row);
  }

  for (const row of submissionRows) {
    byId.set(row.id, row);
  }

  return Array.from(byId.values());
}

async function buildRealWeekDetail(
  weekId: string,
  context: Awaited<ReturnType<typeof readRealWeekContext>>,
  warning: string | null,
  currentUserId: string | null,
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
  const gameRow = weekRow.game_id
    ? context.games.find((game) => game.id === weekRow.game_id)
    : null;
  const rawGame = gameRow
    ? mapGameRowToGame(gameRow)
    : unavailableGame(weekRow.game_id ?? "unassigned");
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
    weekRow.game_id === null;
  const week = mapWeekRowToWeek(weekRow);
  const rules = isSecret
    ? ["El juego, instrucciones y descargas permanecerán ocultos hasta que se anuncie la semana."]
    : week.rules;
  const submissionsResult = isSecret ? null : await getRealSubmissions(weekRow.id);
  const benchmarksResult = isSecret ? null : await getRealWeekBenchmarks(weekRow.id);
  const weeklyResultsResult = isSecret ? null : await getRealWeeklyResults(weekRow.id);
  const warningParts = [
    warning,
    weekRow.game_id === null &&
    preliminaryDerivedStatus !== "draft" &&
    preliminaryDerivedStatus !== "scheduled"
      ? "Configuración incompleta: la semana no tiene juego asignado."
      : null,
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
  const visibleWeekStatus =
    derivedStatus === "final_stretch"
      ? "frozen"
      : derivedStatusToVisibleWeekStatus(derivedStatus);
  const visibleWeek = {
    ...week,
    status: visibleWeekStatus,
    rules,
  };
  const hiddenActivityResult =
    !isSecret && visibleWeek.status === "frozen"
      ? await getHiddenSubmissionActivity(weekRow.id)
      : null;
  const tableSubmissionRows = mergeSubmissionRows(
    realSubmissionRows,
    hiddenActivityResult?.rows ?? [],
  ).map((row) =>
    row.is_hidden &&
    row.player_id !== currentUserId &&
    visibleWeek.status !== "closed" &&
    visibleWeek.status !== "published"
      ? { ...row, score: 0 }
      : row,
  );
  const detailWarningParts = [
    ...warningParts,
    hiddenActivityResult?.error
      ? `No se pudo cargar actividad oculta de tramo final: ${hiddenActivityResult.error}.`
      : null,
  ].filter(Boolean);

  return {
    season: mapSeasonRowToSeason(
      seasonRow,
      context.weeks.filter((row) => row.season_id === seasonRow.id).length,
    ),
    week: visibleWeek,
    game: isSecret ? unannouncedGame() : rawGame,
    leaderboard: isSecret
      ? []
      : buildLeaderboardFromSubmissions(realSubmissionRows, visibleWeek.status),
    benchmarks: isSecret
      ? []
      : realBenchmarkRows.map(mapWeekBenchmarkRowToBenchmark),
    submissions: isSecret
      ? []
      : tableSubmissionRows.map((row) => mapSubmissionRowToSubmission(row, visibleWeek)),
    weeklyResults: realWeeklyResultRows.map(mapWeeklyResultRowToWeeklyResult),
    mode: "supabase",
    warning: detailWarningParts.length > 0 ? detailWarningParts.join(" ") : null,
    isSecret,
    hideDownloads: isSecret,
    leaderboardPending: false,
    submissionsPending: false,
    statusHelp: getWeekStatusHelp(isSecret ? preliminaryDerivedStatus : derivedStatus),
  };
}

export async function getWeekDetailData(
  weekId: string,
  currentUserIdOverride?: string | null,
): Promise<WeekDetailData | null> {
  const currentUserId = currentUserIdOverride ?? await getCurrentUserId();

  if (!currentUserId) {
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

  return buildRealWeekDetail(weekId, context, null, currentUserId);
}

export async function getActiveWeekDetailData(
  currentUserIdOverride?: string | null,
): Promise<ActiveWeekResult> {
  const currentUserId = currentUserIdOverride ?? await getCurrentUserId();

  if (!currentUserId) {
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
  const detail = await buildRealWeekDetail(activeWeeks[0].id, context, warning, currentUserId);

  if (!detail) {
    return {
      status: "empty",
      message: "La semana activa existe, pero su temporada o juego no son visibles.",
      warning,
    };
  }

  return { status: "ok", data: detail };
}

