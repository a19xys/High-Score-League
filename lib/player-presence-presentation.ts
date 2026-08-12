import type { PlayerPresence } from "./player-presence.ts";

export type PresenceIndicatorVariant = "profile" | "compact";

export type PresencePresentation = {
  ariaLabel: string;
  detail: string | null;
  dotClassName: string | null;
  label: string;
};

export function getPlayerPresencePresentation(
  presence: PlayerPresence,
  variant: PresenceIndicatorVariant = "profile",
): PresencePresentation | null {
  if (presence.visibility === "unavailable") {
    return variant === "compact"
      ? null
      : { ariaLabel: "Estado no disponible", detail: null, dotClassName: null, label: "—" };
  }

  if (presence.visibility === "private") {
    return variant === "compact"
      ? null
      : {
          ariaLabel: "Estado privado",
          detail: null,
          dotClassName: "bg-slate-400 dark:bg-slate-500",
          label: "Privado",
        };
  }

  if (presence.status === "offline") {
    return {
      ariaLabel: "Desconectado",
      detail: null,
      dotClassName: "bg-slate-400 dark:bg-slate-500",
      label: "Desconectado",
    };
  }

  if (presence.status === "connected") {
    return {
      ariaLabel: "Conectado",
      detail: null,
      dotClassName: "bg-emerald-500",
      label: "Conectado",
    };
  }

  const gameTitle = presence.game?.title?.trim() || null;

  if (variant === "compact" && gameTitle) {
    return {
      ariaLabel: `Jugando a ${gameTitle}`,
      detail: null,
      dotClassName: "bg-sky-500",
      label: gameTitle,
    };
  }

  return {
    ariaLabel: gameTitle ? `Jugando a ${gameTitle}` : "Jugando",
    detail: variant === "profile" ? gameTitle : null,
    dotClassName: "bg-sky-500",
    label: "Jugando",
  };
}
