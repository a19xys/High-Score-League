import Link from "next/link";
import type { Player } from "@/types";

type PlayerHoverCardProps = {
  player: Player;
};

export function PlayerHoverCard({ player }: PlayerHoverCardProps) {
  return (
    <div className="group relative inline-flex">
      <Link
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold theme-surface-strong"
        href={`/players/${player.username}`}
        title={`${player.initials} · @${player.username}`}
      >
        {player.initials}
      </Link>
      <div className="pointer-events-none absolute left-1/2 top-11 z-20 hidden w-56 -translate-x-1/2 rounded-lg border p-4 shadow-panel group-hover:block theme-border theme-surface">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold theme-surface-strong">
            {player.initials}
          </div>
          <div>
            <p className="font-semibold theme-text">{player.initials}</p>
            <p className="text-sm theme-text-muted">@{player.username}</p>
          </div>
        </div>
        <Link
          className="pointer-events-auto mt-3 inline-flex rounded-md px-3 py-2 text-sm font-semibold theme-surface-strong"
          href={`/players/${player.username}`}
        >
          Ver perfil
        </Link>
      </div>
    </div>
  );
}
