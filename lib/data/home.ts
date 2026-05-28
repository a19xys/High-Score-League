import type { Game, LeaderboardEntry, Season, Week, WeekBenchmark } from "@/types";
import {
  currentSeason,
  currentWeek,
  getChatMessages,
  getCurrentGame,
  getWeeklyLeaderboard,
} from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveRealSeason, mapSeasonRowToSeason } from "./seasons";
import { getDataSource } from "./data-source";
import { getActiveWeekDetailData } from "./week-detail";

export type HomePageData = {
  mode: "mock" | "supabase";
  season: Season | null;
  week: Week | null;
  game: Game | null;
  leaderboard: LeaderboardEntry[];
  benchmarks: WeekBenchmark[];
  warning: string | null;
  activeWeekMessage: string | null;
  activeSeasonMessage: string | null;
  chatMessages: ReturnType<typeof getChatMessages>;
};

function mockHomeData(warning: string | null = null): HomePageData {
  return {
    mode: "mock",
    season: currentSeason,
    week: currentWeek,
    game: getCurrentGame(),
    leaderboard: getWeeklyLeaderboard(currentWeek.id),
    benchmarks: [],
    warning,
    activeWeekMessage: null,
    activeSeasonMessage: null,
    chatMessages: getChatMessages(),
  };
}

async function hasSession() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  return Boolean(data.user);
}

export async function getHomePageData(): Promise<HomePageData> {
  if (getDataSource() !== "supabase") {
    return mockHomeData();
  }

  if (!(await hasSession())) {
    return {
      mode: "supabase",
      season: null,
      week: null,
      game: null,
      leaderboard: [],
      benchmarks: [],
      warning: "Inicia sesión para leer datos reales. RLS puede ocultar temporadas, semanas y puntuaciones sin sesión.",
      activeWeekMessage: "No se puede detectar la semana activa sin sesión.",
      activeSeasonMessage: "No se puede detectar la temporada activa sin sesión.",
      chatMessages: [],
    };
  }

  const [activeWeekResult, activeSeasonRow] = await Promise.all([
    getActiveWeekDetailData({ fallbackToMock: false }),
    getActiveRealSeason(),
  ]);
  const activeSeason = activeSeasonRow ? mapSeasonRowToSeason(activeSeasonRow) : null;

  if (activeWeekResult.status === "ok") {
    return {
      mode: "supabase",
      season: activeSeason ?? activeWeekResult.data.season,
      week: activeWeekResult.data.week,
      game: activeWeekResult.data.game,
      leaderboard: activeWeekResult.data.leaderboard,
      benchmarks: activeWeekResult.data.benchmarks,
      warning: activeWeekResult.data.warning,
      activeWeekMessage: null,
      activeSeasonMessage: activeSeason
        ? null
        : "No hay temporada activa configurada en Supabase.",
      chatMessages: [],
    };
  }

  return {
    mode: "supabase",
    season: activeSeason,
    week: null,
    game: null,
    leaderboard: [],
    benchmarks: [],
    warning: activeWeekResult.warning ?? null,
    activeWeekMessage: activeWeekResult.message,
    activeSeasonMessage: activeSeason
      ? null
      : "No hay temporada activa configurada en Supabase.",
    chatMessages: [],
  };
}
