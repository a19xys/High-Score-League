import type { PlayerPresence } from "@/lib/player-presence";
import {
  getPlayerPresencePresentation,
  type PresenceIndicatorVariant,
} from "@/lib/player-presence-presentation";

export function PlayerPresenceIndicator({
  presence,
  variant = "profile",
}: {
  presence: PlayerPresence;
  variant?: PresenceIndicatorVariant;
}) {
  const presentation = getPlayerPresencePresentation(presence, variant);

  if (!presentation) return null;

  if (variant === "compact") {
    return (
      <span
        aria-label={presentation.ariaLabel}
        className="flex min-w-0 items-center gap-2 text-xs font-semibold theme-text-muted"
      >
        {presentation.dotClassName ? (
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${presentation.dotClassName}`} />
        ) : null}
        <span className="truncate">{presentation.label}</span>
      </span>
    );
  }

  return (
    <span aria-label={presentation.ariaLabel} className="flex min-w-0 flex-col items-center text-center">
      <span className="flex items-center justify-center gap-2">
        {presentation.dotClassName ? (
          <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${presentation.dotClassName}`} />
        ) : null}
        <span className="whitespace-nowrap text-base font-extrabold theme-text sm:text-lg">
          {presentation.label}
        </span>
      </span>
      {presentation.detail ? (
        <span className="mt-2 max-w-full break-words text-xs leading-5 theme-text-muted">
          {presentation.detail}
        </span>
      ) : null}
    </span>
  );
}
