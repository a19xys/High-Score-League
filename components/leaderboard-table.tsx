import {
  formatExactDateTime,
  formatGap,
  formatRelativeTime,
  formatScore,
} from "@/lib/format";
import type { LeaderboardEntry, WeekBenchmark } from "@/types";
import { PlayerPill } from "./player-pill";
import { getRankRowClass, RankBadge } from "./rank-badge";
import { DataTable, TableHead } from "./ui/table";

type LeaderboardTableProps = {
  entries: LeaderboardEntry[];
  benchmarks?: WeekBenchmark[];
};

type LeaderboardVisualRow =
  | { type: "entry"; entry: LeaderboardEntry }
  | { type: "benchmark"; benchmark: WeekBenchmark };

function getVisualRows(entries: LeaderboardEntry[], benchmarks: WeekBenchmark[]) {
  return [
    ...entries.map((entry): LeaderboardVisualRow => ({ type: "entry", entry })),
    ...benchmarks.map(
      (benchmark): LeaderboardVisualRow => ({ type: "benchmark", benchmark }),
    ),
  ].sort((a, b) => {
    const aScore = a.type === "entry" ? a.entry.bestScore : a.benchmark.score;
    const bScore = b.type === "entry" ? b.entry.bestScore : b.benchmark.score;

    if (bScore !== aScore) {
      return bScore - aScore;
    }

    if (a.type !== b.type) {
      return a.type === "entry" ? -1 : 1;
    }

    if (a.type === "benchmark" && b.type === "benchmark") {
      return (
        a.benchmark.sortOrder - b.benchmark.sortOrder ||
        a.benchmark.label.localeCompare(b.benchmark.label)
      );
    }

    return 0;
  });
}

export function LeaderboardTable({
  entries,
  benchmarks = [],
}: LeaderboardTableProps) {
  const rows = getVisualRows(entries, benchmarks);

  return (
    <DataTable>
      <TableHead
        labels={[
          "Puesto",
          "Jugador",
          "Puntuación",
          "Subidas",
          "Última",
          "Diferencia",
        ]}
      />
      <tbody className="divide-y theme-border theme-surface">
        {rows.map((row) => {
          if (row.type === "benchmark") {
            return (
              <tr
                className="bg-[var(--benchmark-row)] hover:bg-[var(--benchmark-row-hover)]"
                key={`benchmark-${row.benchmark.id}`}
              >
                <td className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase theme-text-muted">
                  Referencia
                </td>
                <td className="min-w-56 px-4 py-4">
                  <div>
                    <p className="font-semibold theme-text">{row.benchmark.label}</p>
                    {row.benchmark.description ? (
                      <p
                        className="mt-1 text-xs theme-text-muted"
                        title={row.benchmark.description}
                      >
                        {row.benchmark.description}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                  {formatScore(row.benchmark.score)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">-</td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">-</td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">-</td>
              </tr>
            );
          }

          const { entry } = row;

          return (
            <tr className={getRankRowClass(entry.rank)} key={entry.player.id}>
              <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                <RankBadge rank={entry.rank} />
              </td>
              <td className="min-w-56 px-4 py-4">
                <PlayerPill player={entry.player} />
              </td>
              <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                {formatScore(entry.bestScore)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                {entry.uploads}
              </td>
              <td
                className="whitespace-nowrap px-4 py-4 theme-text-muted"
                title={formatExactDateTime(entry.lastSubmissionAt)}
              >
                {formatRelativeTime(entry.lastSubmissionAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                {formatGap(entry.gapToFirst)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
