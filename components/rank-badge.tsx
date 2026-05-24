const medalStyles: Record<number, string> = {
  1: "border-amber-300 bg-amber-100 text-amber-900",
  2: "border-slate-300 bg-slate-100 text-slate-800",
  3: "border-orange-300 bg-orange-100 text-orange-900",
};

const rowStyles: Record<number, string> = {
  1: "bg-[var(--gold-row)] hover:bg-[var(--gold-row-hover)]",
  2: "bg-[var(--silver-row)] hover:bg-[var(--silver-row-hover)]",
  3: "bg-[var(--bronze-row)] hover:bg-[var(--bronze-row-hover)]",
};

const cardStyles: Record<number, string> = {
  1: "border-amber-300 bg-[var(--gold-row)]",
  2: "border-slate-300 bg-[var(--silver-row)]",
  3: "border-orange-300 bg-[var(--bronze-row)]",
};

export function getRankRowClass(rank: number) {
  return rowStyles[rank] ?? "theme-hover";
}

export function getRankCardClass(rank: number) {
  return cardStyles[rank] ?? "theme-border theme-surface-muted";
}

type RankBadgeProps = {
  rank: number;
};

export function RankBadge({ rank }: RankBadgeProps) {
  if (rank <= 3) {
    return (
      <span
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold ${medalStyles[rank]}`}
        aria-label={`Puesto ${rank}`}
      >
        {rank}
      </span>
    );
  }

  return <span className="font-semibold theme-text">#{rank}</span>;
}
