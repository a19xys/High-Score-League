import { formatScore } from "@/lib/format";
import type { SeasonStanding } from "@/types";
import { PlayerPill } from "./player-pill";
import { getRankRowClass, RankBadge } from "./rank-badge";
import { DataTable } from "./ui/table";

type SeasonTableProps = {
  standings: SeasonStanding[];
};

function PositionChange({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span
        aria-label={`Sube ${value} puestos`}
        className="inline-flex min-w-10 items-center justify-center gap-1 font-semibold text-emerald-700"
        title={`Sube ${value} puestos`}
      >
        <span aria-hidden="true">▲</span>
        <span>{value}</span>
      </span>
    );
  }

  if (value < 0) {
    const absoluteValue = Math.abs(value);

    return (
      <span
        aria-label={`Baja ${absoluteValue} puestos`}
        className="inline-flex min-w-10 items-center justify-center gap-1 font-semibold text-red-700"
        title={`Baja ${absoluteValue} puestos`}
      >
        <span aria-hidden="true">▼</span>
        <span>{absoluteValue}</span>
      </span>
    );
  }

  return (
    <span
      aria-label="Sin cambio de posición"
      className="inline-flex min-w-10 justify-center font-semibold theme-text-muted"
      title="Sin cambio de posición"
    >
      —
    </span>
  );
}

export function SeasonTable({ standings }: SeasonTableProps) {
  const hasAnyPoints = standings.some((standing) => standing.totalPoints > 0);

  return (
    <DataTable>
      <thead className="text-xs font-semibold uppercase theme-table-head">
        <tr>
          <th
            className="w-14 whitespace-nowrap px-2 py-3 text-center sm:w-16 sm:px-3"
            scope="col"
          >
            Puesto
          </th>
          <th
            aria-label="Cambio de posición"
            className="w-12 whitespace-nowrap px-2 py-3 text-center"
            scope="col"
          >
            <span className="sr-only">Cambio de posición</span>
          </th>
          <th className="whitespace-nowrap px-2 py-3 text-left sm:px-3" scope="col">
            Jugador
          </th>
          <th className="whitespace-nowrap px-2 py-3 text-right sm:px-3" scope="col">
            Puntos
          </th>
          <th
            className="hidden whitespace-nowrap px-2 py-3 text-right md:table-cell"
            scope="col"
          >
            1º
          </th>
          <th
            className="hidden whitespace-nowrap px-2 py-3 text-right md:table-cell"
            scope="col"
          >
            2º
          </th>
          <th
            className="hidden whitespace-nowrap px-2 py-3 text-right md:table-cell"
            scope="col"
          >
            3º
          </th>
        </tr>
      </thead>
      <tbody className="divide-y theme-border theme-surface">
        {standings.map((standing) => (
          <tr
            className={hasAnyPoints ? getRankRowClass(standing.rank) : "theme-hover"}
            key={standing.player.id}
          >
            <td className="w-14 whitespace-nowrap px-2 py-4 text-center font-semibold theme-text sm:w-16 sm:px-3">
              {hasAnyPoints ? (
                <RankBadge rank={standing.rank} />
              ) : (
                <span
                  aria-label="Puesto pendiente"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold theme-border theme-text-muted"
                  title="Puesto pendiente"
                >
                  1
                </span>
              )}
            </td>
            <td className="w-12 whitespace-nowrap px-2 py-4 text-center">
              <PositionChange value={standing.positionChange} />
            </td>
            <td className="min-w-0 px-2 py-4 text-left sm:px-3">
              <PlayerPill compactOnMobile player={standing.player} />
            </td>
            <td className="whitespace-nowrap px-2 py-4 text-right font-semibold theme-text sm:px-3">
              {formatScore(standing.totalPoints)}
            </td>
            <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell">
              {standing.firstPlaces}
            </td>
            <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell">
              {standing.secondPlaces}
            </td>
            <td className="hidden whitespace-nowrap px-2 py-4 text-right theme-text-muted md:table-cell">
              {standing.thirdPlaces}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
