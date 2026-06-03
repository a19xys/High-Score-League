import {
  formatExactDateTime,
  formatGap,
  formatRelativeTime,
  formatScore,
} from "@/lib/format";
import type { LeaderboardEntry, WeekBenchmark } from "@/types";
import { PlayerPill } from "./player-pill";
import { getRankRowClass, RankBadge } from "./rank-badge";
import { DataTable } from "./ui/table";

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
      return a.benchmark.label.localeCompare(b.benchmark.label);
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
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="whitespace-nowrap px-4 py-3" scope="col">
            Puesto
          </th>
          <th className="whitespace-nowrap px-4 py-3" scope="col">
            Jugador
          </th>
          <th className="whitespace-nowrap px-4 py-3" scope="col">
            Puntuación
          </th>
          <th className="hidden whitespace-nowrap px-4 py-3 sm:table-cell" scope="col">
            Subidas
          </th>
          <th className="hidden whitespace-nowrap px-4 py-3 sm:table-cell" scope="col">
            Última
          </th>
          <th className="hidden whitespace-nowrap px-4 py-3 sm:table-cell" scope="col">
            Diferencia
          </th>
        </tr>
      </thead>
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
                <td className="min-w-44 px-4 py-4 sm:min-w-56">
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
                <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted sm:table-cell">
                  -
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted sm:table-cell">
                  -
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted sm:table-cell">
                  -
                </td>
              </tr>
            );
          }

          const { entry } = row;

          return (
            <tr className={getRankRowClass(entry.rank)} key={entry.player.id}>
              <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                <RankBadge rank={entry.rank} />
              </td>
              <td className="min-w-44 px-4 py-4 sm:min-w-56">
                <PlayerPill player={entry.player} />
              </td>
              <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                {formatScore(entry.bestScore)}
              </td>
              <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted sm:table-cell">
                {entry.uploads}
              </td>
              <td
                className="hidden whitespace-nowrap px-4 py-4 theme-text-muted sm:table-cell"
                title={formatExactDateTime(entry.lastSubmissionAt)}
              >
                {formatRelativeTime(entry.lastSubmissionAt)}
              </td>
              <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted sm:table-cell">
                {formatGap(entry.gapToFirst)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
