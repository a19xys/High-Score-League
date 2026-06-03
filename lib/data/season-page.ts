import type { SeasonSummary } from "@/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserSeasonMemberships } from "./season-memberships";
import { getRealSeasons, mapSeasonRowToSeason } from "./seasons";
import { getRealWeeks } from "./weeks";

export type SeasonPageData = {
  summaries: SeasonSummary[];
  mode: "supabase";
  warning: string | null;
};

function countWeeksBySeason(
  weekRows: Awaited<ReturnType<typeof getRealWeeks>>["rows"],
) {
  return weekRows.reduce<Record<string, number>>((counts, week) => {
    counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    return counts;
  }, {});
}

export async function getSeasonPageData(): Promise<SeasonPageData> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  const [seasonsResult, weeksResult] = await Promise.all([
    getRealSeasons(),
    getRealWeeks(),
  ]);

  const readError = seasonsResult.error ?? weeksResult.error ?? null;

  if (readError) {
    return {
      summaries: [],
      mode: "supabase",
      warning: readError,
    };
  }

  const weekCounts = countWeeksBySeason(weeksResult.rows);
  const visibleSeasonRows = seasonsResult.rows.filter(
    (season) => season.status !== "draft",
  );
  const memberships =
    supabase && userData.user
      ? await getUserSeasonMemberships(
          supabase,
          userData.user.id,
          visibleSeasonRows.map((season) => season.id),
        )
      : new Map();
  const summaries: SeasonSummary[] = visibleSeasonRows.map((season) => ({
    season: mapSeasonRowToSeason(season, weekCounts[season.id] ?? 0),
    leader: undefined,
    champion: undefined,
    membershipStatus:
      season.status === "active"
        ? memberships.get(season.id)?.status === "active"
          ? "joined"
          : "not_joined"
        : "closed",
  }));

  return {
    summaries,
    mode: "supabase",
    warning: null,
  };
}

