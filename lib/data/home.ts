import type {
  Game,
  LeaderboardEntry,
  Season,
  SeasonStanding,
  Week,
  WeekBenchmark,
} from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRealLeagueChatMessages } from "./league-chat";
import { getActiveRealSeason, mapSeasonRowToSeason } from "./seasons";
import { getActiveWeekDetailData } from "./week-detail";
import { getUserSeasonMemberships } from "./season-memberships";
import { getRealWeeks, mapWeekRowToWeek } from "./weeks";
import { getRealSeasonStandings } from "./season-standings";
import { getDerivedWeekStatusFromRow } from "@/lib/week-status";
import type { LeagueChatMessage } from "@/types";
import type { SeasonMembershipRow, WeekRow } from "@/types/supabase";

type UpcomingWeekSummary = {
  week: Week;
  publicLabel: string;
};

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
  activeSeasonMembership: SeasonMembershipRow | null;
  isActiveSeasonMember: boolean;
  upcomingWeek: UpcomingWeekSummary | null;
  seasonStandings: SeasonStanding[];
  seasonStandingsError: string | null;
};

async function getCurrentUserId() {
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  return data.user?.id ?? null;
}

async function getActiveSeasonMembership(
  seasonId: string | null,
  userId: string,
) {
  if (!seasonId) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const memberships = await getUserSeasonMemberships(supabase, userId, [seasonId]);
  const membership = memberships.get(seasonId);

  return membership?.status === "active" ? membership : null;
}

function findUpcomingWeek(
  rows: WeekRow[],
  seasonId: string | null,
): UpcomingWeekSummary | null {
  if (!seasonId) {
    return null;
  }

  const now = Date.now();
  const upcoming = rows
    .filter((week) => {
      if (week.season_id !== seasonId || week.status === "published") {
        return false;
      }

      if (!week.public_start_at) {
        return false;
      }

      return new Date(week.public_start_at).getTime() > now;
    })
    .sort((a, b) => {
      const dateOrder = (a.public_start_at ?? "").localeCompare(b.public_start_at ?? "");
      return dateOrder || a.week_number - b.week_number;
    })[0];

  if (!upcoming) {
    return null;
  }

  return {
    week: {
      ...mapWeekRowToWeek(upcoming),
      status:
        getDerivedWeekStatusFromRow(upcoming) === "published" ? "published" : "draft",
    },
    publicLabel: "Por anunciar",
  };
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
      activeSeasonMembership: null,
      isActiveSeasonMember: false,
      upcomingWeek: null,
      seasonStandings: [],
      seasonStandingsError: null,
    };
  }

  const [activeWeekResult, activeSeasonRow, chatResult, weeksResult] = await Promise.all([
    getActiveWeekDetailData(),
    getActiveRealSeason(),
    getRealLeagueChatMessages(),
    getRealWeeks(),
  ]);

  const activeSeasonWeekCount = activeSeasonRow
    ? weeksResult.rows.filter((week) => week.season_id === activeSeasonRow.id).length
    : 0;

  const activeSeason = activeSeasonRow
    ? mapSeasonRowToSeason(activeSeasonRow, activeSeasonWeekCount)
    : null;

  const activeSeasonMembership = await getActiveSeasonMembership(
    activeSeason?.id ?? null,
    currentUserId,
  );
  const seasonStandingsResult = activeSeason && activeWeekResult.status !== "ok"
    ? await getRealSeasonStandings(activeSeason.id)
    : null;
  const upcomingWeek =
    activeWeekResult.status === "ok"
      ? null
      : findUpcomingWeek(weeksResult.rows, activeSeason?.id ?? null);
  const warning =
    activeWeekResult.status === "ok"
      ? activeWeekResult.data.warning
      : activeWeekResult.warning ?? weeksResult.error ?? null;

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
      warning,
      statusHelp: activeWeekResult.data.statusHelp,
      activeWeekMessage: null,
      activeSeasonMessage: activeSeason
        ? null
        : "No hay temporada activa configurada.",
      activeSeasonMembership,
      isActiveSeasonMember: Boolean(activeSeasonMembership),
      upcomingWeek,
      seasonStandings: seasonStandingsResult?.rows ?? [],
      seasonStandingsError: seasonStandingsResult?.error ?? null,
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
    warning,
    statusHelp: null,
    activeWeekMessage: activeWeekResult.message,
    activeSeasonMessage: activeSeason
      ? null
      : "No hay temporada activa configurada.",
    activeSeasonMembership,
    isActiveSeasonMember: Boolean(activeSeasonMembership),
    upcomingWeek,
    seasonStandings: seasonStandingsResult?.rows ?? [],
    seasonStandingsError: seasonStandingsResult?.error ?? null,
  };
}
