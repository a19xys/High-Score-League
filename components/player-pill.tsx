import type { Player } from "@/types";

type PlayerPillProps = {
  player: Player;
  compactOnMobile?: boolean;
};

export function PlayerPill({ compactOnMobile = false, player }: PlayerPillProps) {
  const nameClass = compactOnMobile ? "hidden sm:block" : "";
  const avatarClass = compactOnMobile ? "h-8 w-8 sm:h-9 sm:w-9" : "h-9 w-9";
  const gapClass = compactOnMobile ? "gap-2" : "gap-3";

  return (
    <div className={`flex min-w-0 items-center ${gapClass}`}>
      {player.avatarUrl ? (
        <img
          alt={`Avatar de ${player.username}`}
          className={`${avatarClass} shrink-0 rounded-full object-cover theme-surface-strong`}
          src={player.avatarUrl}
        />
      ) : (
        <span
          className={`${avatarClass} flex shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong`}
        >
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
