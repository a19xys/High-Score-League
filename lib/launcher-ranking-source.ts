type SourceWeek = {
  id: string;
  season_id: string;
  week_number: number;
};

type SourceSeason = {
  id: string;
  status: string;
};

type QueryResult<T> = {
  data: T[] | null;
  error: unknown;
};

export async function loadLauncherRankingSource<
  TWeek extends SourceWeek,
  TSeason extends SourceSeason,
>(options: {
  weekIds: string[];
  loadRequestedWeeks: (weekIds: string[]) => PromiseLike<QueryResult<TWeek>>;
  loadSeasons: (seasonIds: string[]) => PromiseLike<QueryResult<TSeason>>;
  loadSeasonWeeks: (seasonIds: string[]) => PromiseLike<QueryResult<TWeek>>;
  deriveStatus: (week: TWeek) => string;
}) {
  const requested = await options.loadRequestedWeeks(options.weekIds);

  if (requested.error) {
    return { ok: false as const, code: "RANKING_WEEKS_QUERY_FAILED" as const };
  }

  const requestedWeeks = requested.data || [];
  const seasonIds = [...new Set(requestedWeeks.map((week) => week.season_id))];

  if (seasonIds.length === 0) {
    return {
      ok: true as const,
      requestedWeeks,
      seasons: [] as TSeason[],
      activeWeekNumbers: new Map<string, number>(),
    };
  }

  const [seasonResult, seasonWeekResult] = await Promise.all([
    options.loadSeasons(seasonIds),
    options.loadSeasonWeeks(seasonIds),
  ]);

  if (seasonResult.error || seasonWeekResult.error) {
    return { ok: false as const, code: "RANKING_CONTEXT_QUERY_FAILED" as const };
  }

  const activeWeekNumbers = new Map<string, number>();

  for (const week of seasonWeekResult.data || []) {
    if (!["active", "final_stretch"].includes(options.deriveStatus(week))) continue;
    const current = activeWeekNumbers.get(week.season_id);
    activeWeekNumbers.set(
      week.season_id,
      current === undefined ? week.week_number : Math.min(current, week.week_number),
    );
  }

  return {
    ok: true as const,
    requestedWeeks,
    seasons: seasonResult.data || [],
    activeWeekNumbers,
  };
}
