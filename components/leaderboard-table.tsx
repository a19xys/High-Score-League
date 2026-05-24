import { formatGap, formatRelativeTime, formatScore } from "@/lib/format";
import type { LeaderboardEntry } from "@/types";
import { PlayerPill } from "./player-pill";
import { getRankRowClass, RankBadge } from "./rank-badge";
import { DataTable, TableHead } from "./ui/table";

type LeaderboardTableProps = {
  entries: LeaderboardEntry[];
};

export function LeaderboardTable({ entries }: LeaderboardTableProps) {
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
      <tbody className="divide-y divide-slate-100 bg-white">
        {entries.map((entry) => (
          <tr className={getRankRowClass(entry.rank)} key={entry.player.id}>
            <td className="whitespace-nowrap px-4 py-4 font-semibold text-ink">
              <RankBadge rank={entry.rank} />
            </td>
            <td className="min-w-56 px-4 py-4">
              <PlayerPill player={entry.player} />
            </td>
            <td className="whitespace-nowrap px-4 py-4 font-semibold text-ink">
              {formatScore(entry.bestScore)}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-700">
              {entry.uploads}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-700">
              {formatRelativeTime(entry.lastSubmissionAt)}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-slate-700">
              {formatGap(entry.gapToFirst)}
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
