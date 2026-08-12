import type { PlayerProfileStats } from "@/lib/data/player-profile";
import { formatPlayTime, type PlayerPlayTime } from "@/lib/playtime";
import type { PlayerPresence } from "@/lib/player-presence";
import { ProfilePresenceStat } from "./profile-presence-stat";

type ProfileStatsProps = {
  stats: PlayerProfileStats;
  playTime: PlayerPlayTime;
  presence: PlayerPresence;
  username: string;
};

export function ProfileStats({ stats, playTime, presence, username }: ProfileStatsProps) {
  const podiumLabel = `${stats.podiums} ${stats.podiums === 1 ? "podio" : "podios"}`;

  return (
    <dl
      aria-label="Resumen del jugador"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-[var(--border)] shadow-panel theme-border lg:grid-cols-4"
    >
      <div className="relative min-w-0 overflow-hidden px-4 py-5 theme-surface sm:px-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-amber-400" />
        <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
          Victorias
        </dt>
        <dd className="mt-2 text-3xl font-black leading-none theme-text sm:text-4xl">
          {stats.victories}
        </dd>
        <p className="mt-2 text-xs leading-5 theme-text-muted">{podiumLabel}</p>
      </div>
      <div className="relative min-w-0 overflow-hidden px-4 py-5 theme-surface sm:px-6">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-fuchsia-500" />
        <dt className="text-[11px] font-extrabold uppercase tracking-[0.12em] theme-text-muted sm:text-xs">
          Medallas
        </dt>
        <dd className="mt-2 text-3xl font-black leading-none theme-text sm:text-4xl">
          —
        </dd>
        <p className="mt-2 text-xs leading-5 theme-text-muted">Próximamente</p>
      </div>
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
      <ProfilePresenceStat
        initialPresence={presence}
        username={username}
      />
    </dl>
  );
}
