import type { Game, Week } from "@/types";
import type { SubmissionRow } from "@/types/supabase";

export type PlayerBestScore = {
  week: Week;
  game?: Game;
  bestScore: number;
  uploads: number;
  latestAt: string;
  rank: number | null;
  seasonName: string | null;
};

export function buildPlayerBestScores({
  rows,
  weeksById,
  gamesById,
  rankByWeekId,
  seasonNamesById,
}: {
  rows: SubmissionRow[];
  weeksById: Map<string, Week>;
  gamesById: Map<string, Game>;
  rankByWeekId: Map<string, number>;
  seasonNamesById: Map<string, string>;
}): PlayerBestScore[] {
  const byWeek = new Map<string, PlayerBestScore>();

  for (const row of rows) {
    const week = weeksById.get(row.week_id);

    if (!week) {
      continue;
    }

    const existing = byWeek.get(row.week_id);
    const latestAt =
      existing && existing.latestAt > row.submitted_at
        ? existing.latestAt
        : row.submitted_at;

    byWeek.set(row.week_id, {
      week,
      game: week.gameId ? gamesById.get(week.gameId) : undefined,
      bestScore: Math.max(existing?.bestScore ?? 0, row.score),
      uploads: (existing?.uploads ?? 0) + 1,
      latestAt,
      rank: rankByWeekId.get(row.week_id) ?? null,
      seasonName: seasonNamesById.get(week.seasonId) ?? null,
    });
  }

  return Array.from(byWeek.values()).sort((a, b) =>
    b.latestAt.localeCompare(a.latestAt),
  );
}
