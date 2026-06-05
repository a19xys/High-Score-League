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

function BenchmarkReferenceIcon() {
  return (
    <span
      aria-label="Referencia"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-[url('/icons/benchmark-reference.png')] bg-contain bg-center bg-no-repeat theme-border theme-surface-muted theme-text-muted"
      role="img"
    >
      <svg
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
      >
        <path
          d="M12 4.5 18.5 12 12 19.5 5.5 12 12 4.5Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M9.5 12h5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
      <span className="sr-only">Referencia</span>
    </span>
  );
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
          <th className="w-14 whitespace-nowrap px-3 py-3 sm:w-20 sm:px-4" scope="col">
            Puesto
          </th>
          <th className="whitespace-nowrap px-3 py-3 sm:px-4" scope="col">
            Jugador
          </th>
          <th className="whitespace-nowrap px-3 py-3 text-right sm:px-4" scope="col">
            Puntuación
          </th>
          <th className="hidden whitespace-nowrap px-4 py-3 text-right lg:table-cell" scope="col">
            Subidas
          </th>
          <th className="hidden whitespace-nowrap px-4 py-3 lg:table-cell" scope="col">
            Última
          </th>
          <th className="hidden whitespace-nowrap px-4 py-3 xl:table-cell" scope="col">
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
                <td className="w-14 whitespace-nowrap px-3 py-4 text-center sm:w-20 sm:px-4">
                  <BenchmarkReferenceIcon />
                </td>
                <td className="min-w-0 px-3 py-4 sm:px-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold theme-text">
                      {row.benchmark.label}
                    </p>
                    {row.benchmark.description ? (
                      <p
                        className="mt-1 hidden truncate text-xs theme-text-muted sm:block"
                        title={row.benchmark.description}
                      >
                        {row.benchmark.description}
                      </p>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-right font-semibold theme-text sm:px-4">
                  {formatScore(row.benchmark.score)}
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 text-right theme-text-muted lg:table-cell">
                  -
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted lg:table-cell">
                  -
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted xl:table-cell">
                  -
                </td>
              </tr>
            );
          }

          const { entry } = row;

          return (
            <tr className={getRankRowClass(entry.rank)} key={entry.player.id}>
              <td className="w-14 whitespace-nowrap px-3 py-4 font-semibold theme-text sm:w-20 sm:px-4">
                <RankBadge rank={entry.rank} />
              </td>
              <td className="min-w-0 px-3 py-4 sm:px-4">
                <PlayerPill compactOnMobile player={entry.player} />
              </td>
              <td className="whitespace-nowrap px-3 py-4 text-right font-semibold theme-text sm:px-4">
                {formatScore(entry.bestScore)}
              </td>
              <td className="hidden whitespace-nowrap px-4 py-4 text-right theme-text-muted lg:table-cell">
                {entry.uploads}
              </td>
              <td
                className="hidden whitespace-nowrap px-4 py-4 theme-text-muted lg:table-cell"
                title={formatExactDateTime(entry.lastSubmissionAt)}
              >
                {formatRelativeTime(entry.lastSubmissionAt)}
              </td>
              <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted xl:table-cell">
                {formatGap(entry.gapToFirst)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
