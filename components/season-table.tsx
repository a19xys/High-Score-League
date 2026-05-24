import { formatScore } from "@/lib/format";
import type { SeasonStanding } from "@/types";
import { PlayerPill } from "./player-pill";
import { getRankRowClass, RankBadge } from "./rank-badge";
import { DataTable, TableHead } from "./ui/table";

type SeasonTableProps = {
  standings: SeasonStanding[];
};

export function SeasonTable({ standings }: SeasonTableProps) {
  return (
    <DataTable>
      <TableHead
        labels={[
          "Posición",
          "Jugador",
          "Puntos",
          "Primeros",
          "Segundos",
          "Semanas",
        ]}
      />
      <tbody className="divide-y divide-slate-100 bg-white">
        {standings.map((standing) => (
          <tr className={getRankRowClass(standing.rank)} key={standing.player.id}>
            <td className="whitespace-nowrap px-4 py-4 font-semibold text-ink">
              <RankBadge rank={standing.rank} />
            </td>
            <td className="min-w-56 px-4 py-4">
              <PlayerPill player={standing.player} />
            </td>
            <td className="whitespace-nowrap px-4 py-4 font-semibold text-ink">
              {formatScore(standing.totalPoints)}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-700">
              {standing.firstPlaces}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-700">
              {standing.secondPlaces}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-700">
              {standing.weeksPlayed}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
