import type { Player } from "@/types";

type PlayerPillProps = {
  player: Player;
};

export function PlayerPill({ player }: PlayerPillProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong">
        {player.initials}
      </span>
      <div className="min-w-0">
        <p className="truncate font-semibold theme-text">{player.initials}</p>
        <p className="truncate text-xs theme-text-muted">@{player.username}</p>
      </div>
    </div>
  );
}
