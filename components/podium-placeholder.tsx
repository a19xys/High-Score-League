import { formatScore } from "@/lib/format";
import { seasonStandings } from "@/lib/mock-data";
import type { SeasonStanding } from "@/types";

function podiumHeight(rank: number) {
  if (rank === 1) {
    return "min-h-56";
  }

  if (rank === 2) {
    return "min-h-44";
  }

  return "min-h-36";
}

function podiumTone(rank: number) {
  if (rank === 1) {
    return "bg-[var(--gold-row)]";
  }

  if (rank === 2) {
    return "bg-[var(--silver-row)]";
  }

  return "bg-[var(--bronze-row)]";
}

type PodiumPlaceholderProps = {
  standings?: SeasonStanding[];
  description?: string;
};

export function PodiumPlaceholder({
  standings = seasonStandings,
  description = "Placeholder preparado para empates en resultados oficiales.",
}: PodiumPlaceholderProps) {
  const podiumStandings = standings
    .filter((standing) => standing.rank <= 3)
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }

      return a.player.username.localeCompare(b.player.username);
    });

  const firstPlaces = podiumStandings.filter((standing) => standing.rank === 1);
  const secondPlaces = podiumStandings.filter((standing) => standing.rank === 2);
  const thirdPlaces = podiumStandings.filter((standing) => standing.rank === 3);
  const normalPodium =
    firstPlaces.length === 1 && secondPlaces.length === 1 && thirdPlaces.length === 1;
  const twoSecondPlaces =
    firstPlaces.length === 1 && secondPlaces.length === 2 && thirdPlaces.length === 0;
  const visualOrder = normalPodium
    ? [secondPlaces[0], firstPlaces[0], thirdPlaces[0]]
    : twoSecondPlaces
      ? [secondPlaces[0], firstPlaces[0], secondPlaces[1]]
      : podiumStandings;

  return (
    <section className="rounded-lg border p-6 theme-border theme-surface-muted">
      <div>
        <p className="text-sm font-semibold uppercase theme-text-muted">
          Resumen de podio
        </p>
        <p className="mt-1 text-sm theme-text-muted">{description}</p>
      </div>
      <div className="mt-8 grid items-end gap-4 sm:grid-cols-3 lg:min-h-80">
        {visualOrder.map((standing) => (
          <div className="flex min-w-0 flex-col items-center text-center" key={standing.player.id}>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full text-base font-bold theme-surface-strong">
              {standing.player.initials}
            </div>
            <div
              className={`flex w-full max-w-56 ${podiumHeight(
                standing.rank,
              )} ${podiumTone(
                standing.rank,
              )} flex-col items-center justify-center rounded-t-lg border px-4 py-5 theme-border`}
            >
              <p className="text-3xl font-bold theme-text">#{standing.rank}</p>
              <p className="mt-3 font-semibold theme-text">{standing.player.initials}</p>
              <p className="max-w-full truncate text-sm theme-text-muted">
                @{standing.player.username}
              </p>
              <p className="mt-4 text-sm font-semibold theme-text">
                {formatScore(standing.totalPoints)} pts
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
