import type { Player } from "@/types";

type PlayerPillProps = {
  player: Player;
  compactOnMobile?: boolean;
};

export function PlayerPill({ compactOnMobile = false, player }: PlayerPillProps) {
  const nameClass = compactOnMobile ? "hidden sm:block" : "";

  return (
    <div className="flex items-center gap-3">
      {player.avatarUrl ? (
        <img
          alt={`Avatar de ${player.username}`}
          className="h-9 w-9 shrink-0 rounded-full object-cover theme-surface-strong"
          src={player.avatarUrl}
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong">
          {player.initials}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-semibold theme-text">{player.initials}</p>
        <p className={`truncate text-xs theme-text-muted ${nameClass}`}>
          @{player.username}
        </p>
      </div>
    </div>
  );
}
