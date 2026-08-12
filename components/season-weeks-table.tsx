import Link from "next/link";
import { formatCompactDateRange } from "@/lib/format";
import type { WeekSummary } from "@/types";
import { EmptyState } from "./ui/state";
import { StatusBadge } from "./ui/status-badge";
import { DataTable } from "./ui/table";

type SeasonWeeksTableProps = {
  currentWeekNumber?: number;
  weeks: WeekSummary[];
};

function isSecretWeek(summary: WeekSummary, currentWeekNumber?: number) {
  return (
    summary.week.status === "draft" ||
    summary.week.gameId === null ||
    (summary.season.status === "active" &&
      typeof currentWeekNumber === "number" &&
      summary.week.number > currentWeekNumber &&
      summary.week.status !== "published")
  );
}

export function SeasonWeeksTable({
  currentWeekNumber,
  weeks,
}: SeasonWeeksTableProps) {
  if (weeks.length === 0) {
    return (
      <EmptyState
        title="No hay semanas visibles."
        description="La temporada existe, pero todavía no tiene semanas asociadas."
      />
    );
  }

  return (
    <DataTable tableClassName="season-weeks-table w-full table-fixed">
      <colgroup>
        <col className="w-[6.25rem] md:w-28" />
        <col />
        <col className="hidden lg:table-column lg:w-40" />
        <col className="hidden md:table-column md:w-28" />
        <col className="w-14 md:w-16 lg:w-32" />
      </colgroup>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th className="px-2 py-3 text-left md:px-3 lg:px-4">Semana</th>
          <th className="px-2 py-3 text-left md:px-3 lg:px-4">Juego</th>
          <th className="hidden px-4 py-3 text-left lg:table-cell">Fechas</th>
          <th className="hidden px-3 py-3 text-left md:table-cell lg:px-4">Estado</th>
          <th className="px-2 py-3 text-right md:px-3 lg:px-4">Acción</th>
        </tr>
      </thead>
      <tbody className="divide-y theme-border theme-surface">
        {weeks.map((summary) => {
          const hasDates = summary.week.startsAt && summary.week.endsAt;
          const secret = isSecretWeek(summary, currentWeekNumber);
          const dateLabel = hasDates
            ? formatCompactDateRange(summary.week.startsAt, summary.week.endsAt)
            : "—";

          return (
            <tr className="theme-hover" key={summary.week.id}>
              <td className="min-w-0 px-2 py-3 align-middle md:px-3 lg:px-4 lg:py-4">
                <p className="truncate whitespace-nowrap font-semibold theme-text">
                  Semana {summary.week.number}
                </p>
                <p className="mt-0.5 truncate whitespace-nowrap text-[11px] font-normal leading-4 theme-text-muted lg:hidden">
                  {dateLabel}
                </p>
              </td>
              <td className="min-w-0 px-2 py-3 align-middle md:px-3 lg:px-4 lg:py-4">
                <p
                  className="truncate whitespace-nowrap theme-text"
                  title={secret ? "Por anunciar" : summary.game.title}
                >
                  {secret ? "Por anunciar" : summary.game.title}
                </p>
                <div className="mt-1 md:hidden">
                  <StatusBadge compact status={summary.week.status} />
                </div>
              </td>
              <td className="hidden whitespace-nowrap px-4 py-4 theme-text-muted lg:table-cell">
                {dateLabel}
              </td>
              <td className="hidden whitespace-nowrap px-3 py-3 md:table-cell lg:px-4 lg:py-4">
                <StatusBadge status={summary.week.status} />
              </td>
              <td className="whitespace-nowrap px-2 py-3 text-right align-middle md:px-3 lg:px-4 lg:py-4">
                {secret ? (
                  <span
                    className="cursor-not-allowed font-semibold theme-text-muted"
                    title="Semana no disponible todavía."
                  >
                    <span aria-hidden="true" className="lg:hidden">—</span>
                    <span className="sr-only lg:hidden">No disponible</span>
                    <span className="hidden lg:inline">No disponible</span>
                  </span>
                ) : (
                  <Link
                    className="rounded-sm font-semibold text-circuit hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
                    href={`/weeks/${summary.week.id}`}
                  >
                    <span className="lg:hidden">Ver</span>
                    <span className="hidden lg:inline">Ver semana</span>
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
