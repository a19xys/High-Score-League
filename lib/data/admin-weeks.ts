import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Game,
  LeaderboardEntry,
  Season,
  Submission,
  Week,
  WeekBenchmark,
  WeeklyResult,
} from "@/types";
import type {
  GameRow,
  SeasonRow,
  SubmissionRow,
  WeekBenchmarkRow,
  WeekRow,
  WeeklyResultRow,
} from "@/types/supabase";
import { mapGameRowToGame } from "./games";
import { mapSeasonRowToSeason } from "./seasons";
import {
  buildLeaderboardFromSubmissions,
  mapSubmissionRowToSubmission,
} from "./submissions";
import { mapWeekBenchmarkRowToBenchmark } from "./week-benchmarks";
import { mapWeeklyResultRowToWeeklyResult } from "./weekly-results";
import { mapWeekRowToWeek } from "./weeks";
import {
  getDerivedWeekStatus,
  getSynchronizedWeekStatus,
} from "@/lib/week-status";
import {
  getWeekDeleteEligibility,
  type WeekDeleteEligibility,
} from "@/lib/admin/delete-safety";

type AdminSubmission = Submission & {
  player?: NonNullable<ReturnType<typeof mapSubmissionRowToSubmission>["player"]>;
  week?: Week;
  game?: Game;
};

export type AdminWeekSummary = {
  season: Season;
  week: Week;
  game: Game;
  submissionCount: number;
  invalidSubmissionCount: number;
  hasWeeklyResults: boolean;
};

export type AdminWeekDetail = AdminWeekSummary & {
  benchmarks: WeekBenchmark[];
  leaderboard: LeaderboardEntry[];
  submissions: AdminSubmission[];
  weeklyResults: WeeklyResult[];
};

export type AdminWeekEditData = {
  week: WeekRow;
  seasons: SeasonRow[];
  games: GameRow[];
  weeks: WeekRow[];
  benchmarks: WeekBenchmarkRow[];
  deleteEligibility: WeekDeleteEligibility;
};

const seasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";
const gameColumns =
  "id,title,year,developers,publishers,perspectives,themes,genres,rom_name,image_url,header_image_url,logo_image_url,accent_color_primary,accent_color_secondary,instructions,manual_url,download_url,notes,created_at,updated_at";
const weekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";
const submissionColumns = `
  id,
  week_id,
  player_id,
  score,
  screenshot_path,
  screenshot_mime_type,
  screenshot_size_bytes,
  comment,
  is_hidden,
  is_valid,
  submitted_at,
  source,
  detected_at,
  rom_name,
  mame_version,
  client_version,
  duplicate_key,
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
const weeklyResultColumns = `
  id,
  week_id,
  player_id,
  final_score,
  rank,
  league_points,
  is_first_place,
  is_second_place,
  is_third_place,
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
const benchmarkColumns =
  "id,week_id,label,score,description,sort_order,is_active,created_at,updated_at";

function unassignedGame(): Game {
  return {
    id: "unassigned",
    title: "Sin juego asignado",
    slug: "sin-juego-asignado",
    developers: [],
    publishers: [],
    perspectives: [],
    themes: [],
    genres: [],
    taxonomyTags: [],
    developer: "",
    publisher: "",
    genre: "",
    imageAlt: "Sin juego asignado",
  };
}

function mapContext(
  weekRows: WeekRow[],
  seasonRows: SeasonRow[],
  gameRows: GameRow[],
  submissionRows: SubmissionRow[],
  weeklyResultRows: WeeklyResultRow[],
) {
  const seasonsById = new Map(seasonRows.map((season) => [season.id, season]));
  const gamesById = new Map(gameRows.map((game) => [game.id, game]));
  const weekCounts = weekRows.reduce<Record<string, number>>((counts, week) => {
    counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    return counts;
  }, {});
  const submissionsByWeek = new Map<string, SubmissionRow[]>();
  const resultsByWeek = new Map<string, WeeklyResultRow[]>();

  for (const submission of submissionRows) {
    const rows = submissionsByWeek.get(submission.week_id) ?? [];
    rows.push(submission);
    submissionsByWeek.set(submission.week_id, rows);
  }

  for (const result of weeklyResultRows) {
    const rows = resultsByWeek.get(result.week_id) ?? [];
    rows.push(result);
    resultsByWeek.set(result.week_id, rows);
  }

  return { seasonsById, gamesById, weekCounts, submissionsByWeek, resultsByWeek };
}

export async function getAdminWeekSummaries(supabase: SupabaseClient) {
  const [weeks, seasons, games, submissions, weeklyResults] = await Promise.all([
    supabase.from("weeks").select(weekColumns).order("public_start_at", {
      ascending: false,
      nullsFirst: false,
    }),
    supabase.from("seasons").select(seasonColumns),
    supabase.from("games").select(gameColumns),
    supabase.from("submissions").select("id,week_id,is_valid"),
    supabase.from("weekly_results").select("id,week_id"),
  ]);

  const error =
    weeks.error ??
    seasons.error ??
    games.error ??
    submissions.error ??
    weeklyResults.error;

  if (error) {
    return { rows: [], error: error.message };
  }

  const weekRows = (weeks.data ?? []) as WeekRow[];
  const seasonRows = (seasons.data ?? []) as SeasonRow[];
  const gameRows = (games.data ?? []) as GameRow[];
  const submissionRows = (submissions.data ?? []) as Array<{
    id: string;
    week_id: string;
    is_valid: boolean;
  }>;
  const resultRows = (weeklyResults.data ?? []) as Array<{
    id: string;
    week_id: string;
  }>;
  const seasonsById = new Map(seasonRows.map((season) => [season.id, season]));
  const gamesById = new Map(gameRows.map((game) => [game.id, game]));
  const weekCounts = weekRows.reduce<Record<string, number>>((counts, week) => {
    counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    return counts;
  }, {});

  return {
    rows: weekRows
      .map((weekRow): AdminWeekSummary | null => {
        const seasonRow = seasonsById.get(weekRow.season_id);

        if (!seasonRow) {
          return null;
        }

        const weekSubmissions = submissionRows.filter(
          (submission) => submission.week_id === weekRow.id,
        );
        const gameRow = weekRow.game_id ? gamesById.get(weekRow.game_id) : null;
        const hasWeeklyResults = resultRows.some(
          (result) => result.week_id === weekRow.id,
        );
        const week = mapWeekRowToWeek(weekRow);

        return {
          season: mapSeasonRowToSeason(seasonRow, weekCounts[seasonRow.id] ?? 0),
          week: {
            ...week,
            status: getSynchronizedWeekStatus(weekRow, new Date(), hasWeeklyResults),
          },
          game: gameRow ? mapGameRowToGame(gameRow) : unassignedGame(),
          submissionCount: weekSubmissions.length,
          invalidSubmissionCount: weekSubmissions.filter(
            (submission) => !submission.is_valid,
          ).length,
          hasWeeklyResults,
        };
      })
      .filter((summary): summary is AdminWeekSummary => Boolean(summary)),
    error: null,
  };
}

export async function getAdminCurrentWeek(supabase: SupabaseClient) {
  const summaries = await getAdminWeekSummaries(supabase);

  if (summaries.error) {
    return { summary: null, activeCount: 0, error: summaries.error };
  }

  const activeWeeks = summaries.rows
    .filter((summary) => {
      const status = getDerivedWeekStatus({
        status: summary.week.status,
        public_start_at: summary.week.startsAt,
        public_freeze_at: undefined,
        final_deadline_at: summary.week.endsAt,
      });
      return status === "active" || status === "final_stretch";
    })
    .sort((a, b) => {
      const dateOrder = a.week.startsAt.localeCompare(b.week.startsAt);
      return dateOrder || a.week.number - b.week.number;
    });

  return {
    summary: activeWeeks[0] ?? null,
    activeCount: activeWeeks.length,
    error: null,
  };
}

export async function getAdminWeekFormOptions(supabase: SupabaseClient) {
  const [seasons, games, weeks] = await Promise.all([
    supabase.from("seasons").select(seasonColumns).order("starts_at", {
      ascending: false,
      nullsFirst: false,
    }),
    supabase.from("games").select(gameColumns).order("title", { ascending: true }),
    supabase.from("weeks").select(weekColumns),
  ]);

  const error = seasons.error ?? games.error ?? weeks.error;

  if (error) {
    return { seasons: [], games: [], weeks: [], error: error.message };
  }

  return {
    seasons: (seasons.data ?? []) as SeasonRow[],
    games: (games.data ?? []) as GameRow[],
    weeks: (weeks.data ?? []) as WeekRow[],
    error: null,
  };
}

export async function getAdminWeekEditData(
  supabase: SupabaseClient,
  weekId: string,
) {
  const [week, options, benchmarks] = await Promise.all([
    supabase.from("weeks").select(weekColumns).eq("id", weekId).maybeSingle(),
    getAdminWeekFormOptions(supabase),
    supabase
      .from("week_benchmarks")
      .select(benchmarkColumns)
      .eq("week_id", weekId)
      .order("score", { ascending: false })
      .order("label", { ascending: true }),
  ]);

  const error = week.error ?? options.error ?? benchmarks.error;

  if (error) {
    return { data: null, error: typeof error === "string" ? error : error.message };
  }

  if (!week.data) {
    return { data: null, error: "Semana no encontrada." };
  }

  return {
    data: {
      week: week.data as WeekRow,
      seasons: options.seasons,
      games: options.games,
      weeks: options.weeks,
      benchmarks: (benchmarks.data ?? []) as WeekBenchmarkRow[],
      deleteEligibility: await getWeekDeleteEligibility(
        supabase,
        (week.data as WeekRow).id,
      ),
    } satisfies AdminWeekEditData,
    error: null,
  };
}

export async function getAdminWeekDetail(
  supabase: SupabaseClient,
  weekId: string,
) {
  const [week, seasons, games, submissions, weeklyResults, benchmarks] =
    await Promise.all([
      supabase.from("weeks").select(weekColumns).eq("id", weekId).maybeSingle(),
      supabase.from("seasons").select(seasonColumns),
      supabase.from("games").select(gameColumns),
      supabase
        .from("submissions")
        .select(submissionColumns)
        .eq("week_id", weekId)
        .order("submitted_at", { ascending: false }),
      supabase
        .from("weekly_results")
        .select(weeklyResultColumns)
        .eq("week_id", weekId)
        .order("rank", { ascending: true }),
      supabase
        .from("week_benchmarks")
        .select(benchmarkColumns)
        .eq("week_id", weekId)
        .eq("is_active", true)
        .order("score", { ascending: false }),
    ]);

  const error =
    week.error ??
    seasons.error ??
    games.error ??
    submissions.error ??
    weeklyResults.error ??
    benchmarks.error;

  if (error) {
    return { data: null, error: error.message };
  }

  if (!week.data) {
    return { data: null, error: "Semana no encontrada." };
  }

  const weekRows = [week.data as WeekRow];
  const seasonRows = (seasons.data ?? []) as SeasonRow[];
  const gameRows = (games.data ?? []) as GameRow[];
  const submissionRows = (submissions.data ?? []) as SubmissionRow[];
  const weeklyResultRows = (weeklyResults.data ?? []) as WeeklyResultRow[];
  const benchmarkRows = (benchmarks.data ?? []) as WeekBenchmarkRow[];
  const context = mapContext(
    weekRows,
    seasonRows,
    gameRows,
    submissionRows,
    weeklyResultRows,
  );
  const seasonRow = context.seasonsById.get(week.data.season_id);

  if (!seasonRow) {
    return { data: null, error: "La temporada de la semana no es visible." };
  }

  const gameRow = week.data.game_id
    ? context.gamesById.get(week.data.game_id)
    : null;
  const mappedWeek = mapWeekRowToWeek(week.data as WeekRow);
  const mappedGame = gameRow ? mapGameRowToGame(gameRow) : unassignedGame();
  const weekSubmissions = context.submissionsByWeek.get(weekId) ?? [];
  const weekResults = context.resultsByWeek.get(weekId) ?? [];
  const synchronizedStatus = getSynchronizedWeekStatus(
    week.data as WeekRow,
    new Date(),
    weekResults.length > 0,
  );
  const visibleWeek = {
    ...mappedWeek,
    status: synchronizedStatus,
  };

  return {
    data: {
      season: mapSeasonRowToSeason(seasonRow, context.weekCounts[seasonRow.id] ?? 0),
      week: visibleWeek,
      game: mappedGame,
      submissionCount: weekSubmissions.length,
      invalidSubmissionCount: weekSubmissions.filter((submission) => !submission.is_valid)
        .length,
      hasWeeklyResults: weekResults.length > 0,
      benchmarks: benchmarkRows.map(mapWeekBenchmarkRowToBenchmark),
      leaderboard: buildLeaderboardFromSubmissions(weekSubmissions, visibleWeek.status),
      submissions: weekSubmissions.map((submission) =>
        mapSubmissionRowToSubmission(submission, visibleWeek),
      ),
      weeklyResults: weekResults.map(mapWeeklyResultRowToWeeklyResult),
    } satisfies AdminWeekDetail,
    error: null,
  };
}
