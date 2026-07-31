import { PlayerHoverCard } from "@/components/player-hover-card";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { formatScore } from "@/lib/format";
import type { LeaderboardEntry } from "@/types";

const podiumStyles: Record<
  number,
  {
    card: string;
    cardShine: string;
    rank: string;
    score: string;
  }
> = {
  1: {
    card: "border-amber-300/80 bg-[var(--gold-row)] shadow-[0_14px_32px_rgba(245,158,11,0.18)] motion-safe:hover:shadow-[0_22px_46px_rgba(245,158,11,0.24)]",
    cardShine: "top-three-card-shine-gold",
    rank: "border-amber-200 bg-amber-400 text-amber-950",
    score: "top-three-score-gold",
  },
  2: {
    card: "border-slate-300/80 bg-[var(--silver-row)] shadow-[0_14px_32px_rgba(148,163,184,0.18)] motion-safe:hover:shadow-[0_22px_46px_rgba(148,163,184,0.24)]",
    cardShine: "top-three-card-shine-silver",
    rank: "border-slate-200 bg-slate-300 text-slate-950",
    score: "top-three-score-silver",
  },
  3: {
    card: "border-orange-300/80 bg-[var(--bronze-row)] shadow-[0_14px_32px_rgba(249,115,22,0.17)] motion-safe:hover:shadow-[0_22px_46px_rgba(249,115,22,0.23)]",
    cardShine: "top-three-card-shine-bronze",
    rank: "border-orange-200 bg-orange-400 text-orange-950",
    score: "top-three-score-bronze",
  },
};

type TopThreeSummaryProps = {
  entries: LeaderboardEntry[];
};

function TopThreeRankBadge({ rank }: { rank: number }) {
  const style = podiumStyles[rank]?.rank ?? "border-[var(--border)] theme-surface theme-text";

  return (
    <span
      aria-label={`Puesto ${rank}`}
      className={`top-three-rank-shine relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xl font-black shadow-sm ${style}`}
    >
      <span aria-hidden="true" className="top-three-rank-shine-bar" />
      <span className="relative z-[1]">{rank}</span>
    </span>
  );
}

export function TopThreeSummary({ entries }: TopThreeSummaryProps) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
      {entries.map((entry) => {
        const style = podiumStyles[entry.rank] ?? podiumStyles[3];

        return (
          <article
            className={`group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-lg border p-4 transition duration-200 ease-out motion-safe:hover:-translate-y-1 ${style.card}`}
            key={entry.player.id}
          >
            <span
              aria-hidden="true"
              className={`top-three-card-shine pointer-events-none absolute ${style.cardShine}`}
            />
            <div className="relative z-[1] flex min-w-0 items-start justify-between gap-3">
              <PlayerHoverCard
                aria-label={`Ver perfil de @${entry.player.username}`}
                className="-m-1 flex min-w-0 items-center gap-3 rounded-xl p-1 transition hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
                player={entry.player}
              >
                <ProfileAvatar
                  avatarUrl={entry.player.avatarUrl}
                  decorative
                  initials={entry.player.initials}
                  size="medium"
                  username={entry.player.username}
                />
                <span className="min-w-0">
                  <span className="block truncate text-base font-black theme-text">
                    {entry.player.initials}
                  </span>
                  <span className="block truncate text-sm theme-text-muted">
                    @{entry.player.username}
                  </span>
                </span>
              </PlayerHoverCard>
              <TopThreeRankBadge rank={entry.rank} />
            </div>

            <div className={`relative z-[1] mt-5 rounded-md border px-4 py-3 text-right ${style.score}`}>
              <p className="text-xs font-bold uppercase tracking-wide theme-text-muted">
                Score
              </p>
              <p className="mt-1 truncate text-3xl font-black leading-none theme-text sm:text-4xl">
                {formatScore(entry.bestScore)}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
