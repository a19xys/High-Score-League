import type { PlayerProfileStats } from "@/lib/data/player-profile";
import { formatPlayTime, type PlayerPlayTime } from "@/lib/playtime";

type ProfileStatsProps = {
  stats: PlayerProfileStats;
  playTime: PlayerPlayTime;
};

const statDefinitions: Array<{
  key: "victories" | "podiums" | "participations";
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
];

export function ProfileStats({ stats, playTime }: ProfileStatsProps) {
  return (
    <dl
      aria-label="Resumen del jugador"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[var(--border)] shadow-panel theme-border lg:grid-cols-5"
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
          <p className="mt-2 hidden text-xs leading-5 theme-text-muted md:block">
            {stat.help}
          </p>
        </div>
      ))}
      <div className="relative min-w-0 overflow-hidden px-4 py-5 theme-surface sm:px-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-emerald-500" />
        <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
          Tiempo jugado
        </dt>
        <dd className={`${playTime.visibility === "private" ? "text-base leading-6 sm:text-lg" : "text-3xl leading-none sm:text-4xl"} mt-2 font-black theme-text`}>
          {playTime.visibility === "visible"
            ? formatPlayTime(playTime.totalSeconds)
            : "Privado"}
        </dd>
        <p className="mt-2 hidden text-xs leading-5 theme-text-muted md:block">
          {playTime.visibility === "visible"
            ? "Práctica y competición registradas por el launcher"
            : "Esta información no se muestra al resto"}
        </p>
      </div>
      <div className="relative col-span-2 min-w-0 overflow-hidden px-4 py-5 theme-surface sm:px-6 lg:col-span-1">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-sky-500" />
        <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
          Estado
        </dt>
        <dd className="mt-2 text-3xl font-black leading-none theme-text sm:text-4xl">
          <span aria-label="Estado no disponible">—</span>
        </dd>
      </div>
    </dl>
  );
}
