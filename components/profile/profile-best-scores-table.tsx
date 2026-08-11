import Link from "next/link";
import { RankBadge } from "@/components/rank-badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/state";
import { formatScore } from "@/lib/format";
import type { PlayerBestScore } from "@/lib/data/player-profile";

export function ProfileBestScoresTable({
  scores,
}: {
  scores: PlayerBestScore[];
}) {
  return (
    <section className="rounded-2xl border p-3 shadow-panel theme-border theme-surface sm:p-6">
      <div className="mb-4">
        <p className="text-xs font-extrabold uppercase tracking-[0.12em] theme-text-muted">
          Archivo personal
        </p>
        <h2 className="mt-1 text-xl font-black theme-text">Mejores marcas</h2>
      </div>

      {scores.length > 0 ? (
        <DataTable tableClassName="w-full table-fixed">
          <colgroup>
            <col className="w-14 sm:w-16" />
            <col />
            <col className="w-24 sm:w-32" />
          </colgroup>
          <thead className="text-[10px] font-semibold uppercase tracking-wide theme-table-head sm:text-xs">
            <tr>
              <th className="px-2 py-2.5 text-left sm:px-3" scope="col">
                Puesto
              </th>
              <th className="px-2 py-2.5 text-left sm:px-3" scope="col">
                Juego
              </th>
              <th className="px-2 py-2.5 text-right sm:px-3" scope="col">
                Mejor marca
              </th>
            </tr>
          </thead>
          <tbody className="divide-y theme-border theme-surface">
            {scores.slice(0, 8).map((score) => (
              <tr className="h-14 theme-hover" key={score.week.id}>
                <td className="h-14 overflow-hidden px-2 py-0 align-middle sm:px-3">
                  {score.rank === null ? (
                    <span className="theme-text-muted" aria-label="Sin puesto oficial">
                      —
                    </span>
                  ) : (
                    <RankBadge rank={score.rank} />
                  )}
                </td>
                <td className="h-14 min-w-0 overflow-hidden px-2 py-0 align-middle sm:px-3">
                  <div className="min-w-0 overflow-hidden">
                    <Link
                      className="block truncate text-sm font-extrabold theme-text transition hover:text-circuit focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-circuit"
                      href={`/weeks/${score.week.id}`}
                    >
                      {score.game?.title ?? "Juego no disponible"}
                    </Link>
                    <p className="truncate text-[11px] leading-4 theme-text-muted sm:text-xs">
                      Semana {score.week.number}
                      {score.seasonName ? ` · ${score.seasonName}` : ""}
                    </p>
                  </div>
                </td>
                <td className="h-14 min-w-0 overflow-hidden px-2 py-0 text-right align-middle font-black tabular-nums theme-text sm:px-3">
                  <span
                    className="block truncate"
                    title={formatScore(score.bestScore)}
                  >
                    {formatScore(score.bestScore)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState
          title="Sin mejores marcas todavía."
          description="Aquí aparecerá el mejor score visible de cada semana."
        />
      )}
    </section>
  );
}
