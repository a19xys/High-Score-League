import type { PlayerProfileStats } from "@/lib/data/player-profile";

type ProfileStatsProps = {
  stats: PlayerProfileStats;
};

const statDefinitions: Array<{
  key: keyof PlayerProfileStats;
  label: string;
  help: string;
  accent: string;
}> = [
  {
    key: "victories",
    label: "Victorias",
    help: "Primeros puestos en resultados oficiales",
    accent: "bg-amber-400",
  },
  {
    key: "podiums",
    label: "Podios",
    help: "Resultados oficiales entre los tres primeros",
    accent: "bg-fuchsia-500",
  },
  {
    key: "participations",
    label: "Participaciones",
    help: "Semanas con actividad competitiva registrada",
    accent: "bg-circuit",
  },
  {
    key: "officialResults",
    label: "Resultados",
    help: "Semanas con clasificación oficial publicada",
    accent: "bg-sky-500",
  },
];

export function ProfileStats({ stats }: ProfileStatsProps) {
  return (
    <dl
      aria-label="Resumen competitivo"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[var(--border)] shadow-panel theme-border lg:grid-cols-4"
    >
      {statDefinitions.map((stat) => (
        <div
          className="relative min-w-0 overflow-hidden px-4 py-5 theme-surface sm:px-6"
          key={stat.key}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-x-0 top-0 h-1 ${stat.accent}`}
          />
          <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
            {stat.label}
          </dt>
          <dd className="mt-2 text-3xl font-black leading-none theme-text sm:text-4xl">
            {stats[stat.key]}
          </dd>
          <p className="mt-2 hidden text-xs leading-5 theme-text-muted sm:block">
            {stat.help}
          </p>
        </div>
      ))}
    </dl>
  );
}
