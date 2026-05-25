import type { SeasonSummary } from "@/types";
import { getSeasonSummaries } from "@/lib/mock-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDataSource } from "./data-source";
import { getRealSeasons, mapSeasonRowToSeason } from "./seasons";
import { getRealWeeks } from "./weeks";

export type SeasonPageData = {
  summaries: SeasonSummary[];
  mode: "mock" | "supabase";
  warning: string | null;
  usingFallback: boolean;
};

function getVisibleMockSummaries(): SeasonSummary[] {
  return getSeasonSummaries().filter(
    (summary) => summary.season.status !== "draft",
  );
}

function fallbackToMock(warning: string | null): SeasonPageData {
  return {
    summaries: getVisibleMockSummaries(),
    mode: "mock",
    warning,
    usingFallback: Boolean(warning),
  };
}

function countWeeksBySeason(
  weekRows: Awaited<ReturnType<typeof getRealWeeks>>["rows"],
) {
  return weekRows.reduce<Record<string, number>>((counts, week) => {
    counts[week.season_id] = (counts[week.season_id] ?? 0) + 1;
    return counts;
  }, {});
}

export async function getSeasonPageData(): Promise<SeasonPageData> {
  if (getDataSource() !== "supabase") {
    return fallbackToMock(null);
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };

  if (!userData.user) {
    return fallbackToMock(
      "NEXT_PUBLIC_DATA_SOURCE=supabase, pero no hay sesion activa. Mostrando fallback mock porque RLS puede ocultar seasons.",
    );
  }

  const [seasonsResult, weeksResult] = await Promise.all([
    getRealSeasons(),
    getRealWeeks(),
  ]);

  if (seasonsResult.error || weeksResult.error) {
    return fallbackToMock(
      seasonsResult.error ??
        weeksResult.error ??
        "No se pudieron leer temporadas reales. Mostrando fallback mock.",
    );
  }

  const weekCounts = countWeeksBySeason(weeksResult.rows);
  const summaries: SeasonSummary[] = seasonsResult.rows
    .filter((season) => season.status !== "draft")
    .map((season) => ({
      season: mapSeasonRowToSeason(season, weekCounts[season.id] ?? 0),
      leader: undefined,
      champion: undefined,
    }));

  return {
    summaries,
    mode: "supabase",
    warning: null,
    usingFallback: false,
  };
}
