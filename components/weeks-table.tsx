import Link from "next/link";
import { formatWeekRange } from "@/lib/format";
import type { WeekSummary } from "@/types";
import { PlayerPill } from "./player-pill";
import { StatusBadge } from "./ui/status-badge";
import { EmptyState } from "./ui/state";
import { DataTable, TableHead } from "./ui/table";

type WeeksTableProps = {
  weeks: WeekSummary[];
};

export function WeeksTable({ weeks }: WeeksTableProps) {
  if (weeks.length === 0) {
    return (
      <EmptyState
        title="No hay semanas configuradas."
        description="Cuando conectemos Supabase, aquí aparecerá el archivo de semanas de la liga."
      />
    );
  }

  return (
    <DataTable>
      <TableHead
        labels={[
          "Temporada",
          "Semana",
          "Juego",
          "Fechas",
          "Estado",
          "Ganador",
          "Detalle",
        ]}
      />
      <tbody className="divide-y theme-border theme-surface">
        {weeks.map((summary) => (
          <tr className="theme-hover" key={summary.week.id}>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {summary.season.name}
            </td>
            <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
              Semana {summary.week.number}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text">
              {summary.game.title}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {formatWeekRange(summary.week.startsAt, summary.week.endsAt)}
            </td>
            <td className="whitespace-nowrap px-4 py-4">
              <StatusBadge status={summary.week.status} />
            </td>
            <td className="min-w-48 px-4 py-4">
              {summary.winner ? (
                <PlayerPill player={summary.winner} />
              ) : (
                <span className="theme-text-muted">Pendiente</span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-4">
              <Link
                className="font-semibold text-circuit hover:underline"
                href={`/weeks/${summary.week.id}`}
              >
                Ver semana
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
