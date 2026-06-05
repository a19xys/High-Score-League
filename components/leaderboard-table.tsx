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

type MaskedIconProps = {
  label: string;
  src: string;
};

function MaskedIcon({ label, src }: MaskedIconProps) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center theme-text"
      role="img"
    >
      <span
        aria-hidden="true"
        className="h-7 w-7 bg-current"
        style={{
          WebkitMask: `url('${src}') center / contain no-repeat`,
          mask: `url('${src}') center / contain no-repeat`,
        }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function BenchmarkReferenceIcon() {
  return <MaskedIcon label="Referencia" src="/icons/benchmark-reference.png" />;
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
          <th className="w-14 whitespace-nowrap px-2 py-3 text-center sm:w-16 sm:px-3" scope="col">
            Puesto
          </th>
          <th className="whitespace-nowrap px-2 py-3 text-left sm:px-3" scope="col">
            Jugador
          </th>
          <th className="whitespace-nowrap px-2 py-3 text-right sm:px-3" scope="col">
            Score
          </th>
          <th className="hidden whitespace-nowrap px-2 py-3 text-right md:table-cell lg:px-3" scope="col">
            Subidas
          </th>
          <th className="hidden whitespace-nowrap px-2 py-3 text-right md:table-cell lg:px-3" scope="col">
            Última
          </th>
          <th className="hidden whitespace-nowrap px-2 py-3 text-right lg:table-cell lg:px-3" scope="col">
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
                <td className="w-14 whitespace-nowrap px-2 py-4 text-center sm:w-16 sm:px-3">
                  <BenchmarkReferenceIcon />
                </td>
                <td className="min-w-0 px-2 py-4 text-left sm:px-3">
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
                <td className="whitespace-nowrap px-2 py-4 text-right font-semibold theme-text sm:px-3">
                  {formatScore(row.benchmark.score)}
                </td>
                <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell lg:px-3">
                  -
                </td>
                <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell lg:px-3">
                  -
                </td>
                <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted lg:table-cell lg:px-3">
                  -
                </td>
              </tr>
            );
          }

          const { entry } = row;

          return (
            <tr className={getRankRowClass(entry.rank)} key={entry.player.id}>
              <td className="w-14 whitespace-nowrap px-2 py-4 text-center font-semibold theme-text sm:w-16 sm:px-3">
                <RankBadge rank={entry.rank} />
              </td>
              <td className="min-w-0 px-2 py-4 text-left sm:px-3">
                <PlayerPill compactOnMobile player={entry.player} />
              </td>
              <td className="whitespace-nowrap px-2 py-4 text-right font-semibold theme-text sm:px-3">
                {formatScore(entry.bestScore)}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell lg:px-3">
                {entry.uploads}
              </td>
              <td
                className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell lg:px-3"
                title={formatExactDateTime(entry.lastSubmissionAt)}
              >
                {formatRelativeTime(entry.lastSubmissionAt)}
              </td>
              <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted lg:table-cell lg:px-3">
                {formatGap(entry.gapToFirst)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
