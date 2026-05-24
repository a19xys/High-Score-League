import Link from "next/link";
import { formatWeekRange } from "@/lib/format";
import type { SeasonSummary } from "@/types";
import { PlayerPill } from "./player-pill";
import { EmptyState } from "./ui/state";
import { DataTable, TableHead } from "./ui/table";

const seasonStatusLabels: Record<SeasonSummary["season"]["status"], string> = {
  active: "Abierta",
  completed: "Cerrada",
  draft: "Borrador",
};

type SeasonsTableProps = {
  seasons: SeasonSummary[];
};

export function SeasonsTable({ seasons }: SeasonsTableProps) {
  if (seasons.length === 0) {
    return (
      <EmptyState
        title="No hay temporadas creadas."
        description="Cuando exista administración real, las temporadas aparecerán aquí."
      />
    );
  }

  return (
    <DataTable>
      <TableHead
        labels={["Temporada", "Versión", "Estado", "Fechas", "Líder/Campeón", "Detalle"]}
      />
      <tbody className="divide-y theme-border theme-surface">
        {seasons.map(({ season, leader, champion }) => (
          <tr className="theme-hover" key={season.id}>
            <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
              {season.name}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {season.version ?? "-"}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {seasonStatusLabels[season.status]}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {formatWeekRange(season.startsAt, season.endsAt)}
            </td>
            <td className="min-w-48 px-4 py-4">
              {champion || leader ? (
                <PlayerPill player={(champion ?? leader)!} />
              ) : (
                <span className="theme-text-muted">Pendiente</span>
              )}
            </td>
            <td className="whitespace-nowrap px-4 py-4">
              <Link
                className="font-semibold text-circuit hover:underline"
                href={`/seasons/${season.id}`}
              >
                Ver temporada
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
