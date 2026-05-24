import type { Player } from "@/types";

type PlayerPillProps = {
  player: Player;
};

export function PlayerPill({ player }: PlayerPillProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
        {player.initials}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{player.name}</p>
        <p className="truncate text-xs text-slate-500">@{player.handle}</p>
      </div>
    </div>
  );
}
