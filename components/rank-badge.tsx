const medalStyles: Record<number, string> = {
  1: "border-amber-300 bg-amber-100 text-amber-900",
  2: "border-slate-300 bg-slate-100 text-slate-800",
  3: "border-orange-300 bg-orange-100 text-orange-900",
};

const rowStyles: Record<number, string> = {
  1: "bg-amber-50/70 hover:bg-amber-50",
  2: "bg-slate-50/90 hover:bg-slate-100",
  3: "bg-orange-50/70 hover:bg-orange-50",
};

const cardStyles: Record<number, string> = {
  1: "border-amber-300 bg-amber-50",
  2: "border-slate-300 bg-slate-50",
  3: "border-orange-300 bg-orange-50",
};

export function getRankRowClass(rank: number) {
  return rowStyles[rank] ?? "hover:bg-slate-50";
}

export function getRankCardClass(rank: number) {
  return cardStyles[rank] ?? "border-slate-200 bg-slate-50";
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

  return <span className="font-semibold text-ink">#{rank}</span>;
}
