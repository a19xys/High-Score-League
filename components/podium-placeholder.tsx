import { seasonStandings } from "@/lib/mock-data";

export function PodiumPlaceholder() {
  const podium = [2, 1, 3]
    .map((rank) => seasonStandings.find((standing) => standing.rank === rank))
    .filter(Boolean);

  return (
    <div className="rounded-lg border p-5 theme-border theme-surface-muted">
      <p className="text-sm font-semibold uppercase theme-text-muted">
        Resumen de podios
      </p>
      <div className="mt-6 grid items-end gap-4 sm:grid-cols-3">
        {podium.map((standing) => {
          const height =
            standing!.rank === 1 ? "h-32" : standing!.rank === 2 ? "h-24" : "h-20";

          return (
            <div className="text-center" key={standing!.player.id}>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full text-sm font-bold theme-surface-strong">
                {standing!.player.initials}
              </div>
              <div
                className={`flex ${height} flex-col items-center justify-center rounded-t-lg border px-3 theme-border theme-surface`}
              >
                <p className="text-2xl font-bold theme-text">#{standing!.rank}</p>
                <p className="mt-1 font-semibold theme-text">
                  {standing!.player.initials}
                </p>
                <p className="text-xs theme-text-muted">
                  @{standing!.player.username}
                </p>
                <p className="mt-2 text-sm theme-text-muted">
                  {standing!.totalPoints} pts
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
