import type { Game, LeaderboardEntry, Season, Week, WeekBenchmark } from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRealLeagueChatMessages } from "./league-chat";
import { getActiveRealSeason, mapSeasonRowToSeason } from "./seasons";
import { getActiveWeekDetailData } from "./week-detail";
import type { LeagueChatMessage } from "@/types";

export type HomePageData = {
  mode: "supabase";
  season: Season | null;
  week: Week | null;
  game: Game | null;
  leaderboard: LeaderboardEntry[];
  benchmarks: WeekBenchmark[];
  chatMessages: LeagueChatMessage[];
  canPostChat: boolean;
  currentUserId: string | null;
  chatError: string | null;
  warning: string | null;
  statusHelp: string | null;
  activeWeekMessage: string | null;
  activeSeasonMessage: string | null;
};

async function getCurrentUserId() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  return data.user?.id ?? null;
}

export async function getHomePageData(): Promise<HomePageData> {
  const currentUserId = await getCurrentUserId();

  if (!currentUserId) {
    return {
      mode: "supabase",
      season: null,
      week: null,
      game: null,
      leaderboard: [],
      benchmarks: [],
      chatMessages: [],
      canPostChat: false,
      currentUserId: null,
      chatError: null,
      warning: null,
      statusHelp: null,
      activeWeekMessage: "Inicia sesión para ver la semana activa.",
      activeSeasonMessage: "Inicia sesión para ver la temporada activa.",
    };
  }

  const [activeWeekResult, activeSeasonRow, chatResult] = await Promise.all([
    getActiveWeekDetailData(),
    getActiveRealSeason(),
    getRealLeagueChatMessages(),
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
      chatMessages: chatResult.rows,
      canPostChat: true,
      currentUserId,
      chatError: chatResult.error,
      warning: activeWeekResult.data.warning,
      statusHelp: activeWeekResult.data.statusHelp,
      activeWeekMessage: null,
      activeSeasonMessage: activeSeason
        ? null
        : "No hay temporada activa configurada.",
    };
  }

  return {
    mode: "supabase",
    season: activeSeason,
    week: null,
    game: null,
    leaderboard: [],
    benchmarks: [],
    chatMessages: chatResult.rows,
    canPostChat: true,
    currentUserId,
    chatError: chatResult.error,
    warning: activeWeekResult.warning ?? null,
    statusHelp: null,
    activeWeekMessage: activeWeekResult.message,
    activeSeasonMessage: activeSeason
      ? null
      : "No hay temporada activa configurada.",
  };
}
