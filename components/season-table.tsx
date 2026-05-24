import { formatScore } from "@/lib/format";
import type { SeasonStanding } from "@/types";
import { PlayerPill } from "./player-pill";
import { getRankRowClass, RankBadge } from "./rank-badge";
import { DataTable, TableHead } from "./ui/table";

type SeasonTableProps = {
  standings: SeasonStanding[];
};

function PositionChange({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
        ▲ {value}
      </span>
    );
  }

  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-red-700">
        ▼ {Math.abs(value)}
      </span>
    );
  }

  return <span className="font-semibold theme-text-muted">—</span>;
}

export function SeasonTable({ standings }: SeasonTableProps) {
  return (
    <DataTable>
      <TableHead
        labels={[
          "Posición",
          "▲",
          "Jugador",
          "Puntos",
          "Primeros",
          "Segundos",
          "Terceros",
        ]}
      />
      <tbody className="divide-y theme-border theme-surface">
        {standings.map((standing) => (
          <tr className={getRankRowClass(standing.rank)} key={standing.player.id}>
            <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
              <RankBadge rank={standing.rank} />
            </td>
            <td className="whitespace-nowrap px-4 py-4">
              <PositionChange value={standing.positionChange} />
            </td>
            <td className="min-w-56 px-4 py-4">
              <PlayerPill player={standing.player} />
            </td>
            <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
              {formatScore(standing.totalPoints)}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {standing.firstPlaces}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {standing.secondPlaces}
            </td>
            <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
              {standing.thirdPlaces}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
