import { ProfileAvatar } from "@/components/profile/profile-avatar";
import type { Player } from "@/types";
import { PlayerHoverCard } from "./player-hover-card";

type PlayerPillProps = {
  player: Player;
  compactOnMobile?: boolean;
  linkToProfile?: boolean;
  variant?: "default" | "submission";
};

export function PlayerPill({
  compactOnMobile = false,
  linkToProfile = true,
  player,
  variant = "default",
}: PlayerPillProps) {
  const isSubmission = variant === "submission";
  const nameClass = compactOnMobile ? "hidden sm:block" : "";
  const gapClass = isSubmission ? "gap-1.5" : compactOnMobile ? "gap-2" : "gap-3";
  const content = (
    <>
      <ProfileAvatar
        avatarUrl={player.avatarUrl}
        decorative
        initials={player.initials}
        size={isSubmission ? "submission" : "pill"}
        username={player.username}
      />
      <span className="min-w-0">
        <span className={`block truncate font-semibold theme-text ${isSubmission ? "text-sm" : ""}`}>
          {player.initials}
        </span>
        {isSubmission ? null : (
          <span className={`block truncate text-xs theme-text-muted ${nameClass}`}>
            @{player.username}
          </span>
        )}
      </span>
    </>
  );

  if (!linkToProfile || !player.username.trim()) {
    return (
      <span className={`flex min-w-0 items-center ${gapClass}`}>{content}</span>
    );
  }

  return (
    <PlayerHoverCard
      aria-label={`Ver perfil de @${player.username}`}
      className={`flex min-w-0 items-center rounded-xl transition hover:bg-[var(--hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
        isSubmission ? "-my-1 -ml-1 min-h-10 p-1" : "-m-1 p-1"
      } ${gapClass}`}
      player={player}
    >
      {content}
    </PlayerHoverCard>
  );
}
