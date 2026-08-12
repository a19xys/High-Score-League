"use client";

import Link from "next/link";
import {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { PlayerPresenceIndicator } from "@/components/player-presence-indicator";
import type { PlayerProfilePreview } from "@/lib/data/player-profile-preview";
import type { PlayerPresence } from "@/lib/player-presence";
import {
  getCachedPlayerProfilePreview,
  requestCachedPlayerProfilePreview,
} from "@/lib/player-profile-preview-cache";
import {
  getPlayerHoverPresenceSnapshot,
  rememberPlayerHoverPresence,
} from "@/lib/player-hover-presence-snapshots";
import { getProfileBioDisplay } from "@/lib/profile";
import {
  calculatePlayerHoverCardPosition,
  type HoverCardPosition,
} from "@/lib/player-hover-card-position";
import type { Player } from "@/types";

export const PLAYER_HOVER_OPEN_DELAY_MS = 600;
export const PLAYER_HOVER_CLOSE_DELAY_MS = 220;
const viewportPadding = 12;
const cardGap = 6;

const CurrentPlayerContext = createContext<string | null>(null);

type PlayerHoverCardProviderProps = {
  children: ReactNode;
  currentUserId: string | null;
};

type PlayerHoverCardProps = {
  ariaLabel?: string;
  children: ReactNode;
  className: string;
  player: Player;
  title?: string;
};

type PreviewPayload = {
  ok: boolean;
  preview?: PlayerProfilePreview;
};

type PresencePayload = {
  ok: boolean;
  presence?: PlayerPresence;
};

type PresenceRequestResult =
  | { status: "resolved"; presence: PlayerPresence | null }
  | { status: "error" };

function playerCacheKey(player: Player) {
  return player.id || player.username;
}

async function requestPlayerPreview(player: Player) {
  return requestCachedPlayerProfilePreview(
    { playerId: player.id, username: player.username },
    async (signal) => {
      const response = await fetch(
        `/api/players/${encodeURIComponent(player.username)}/preview`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal,
        },
      );

      if (!response.ok) {
        throw new Error("player-preview-unavailable");
      }

      const payload = (await response.json()) as PreviewPayload;

      if (!payload.ok || !payload.preview) {
        throw new Error("player-preview-invalid");
      }

      return payload.preview;
    },
  );
}

async function requestPlayerPresence(
  player: Player,
): Promise<PresenceRequestResult> {
  try {
    const response = await fetch(
      `/api/players/${encodeURIComponent(player.username)}/presence`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) return { status: "error" };
    const payload = (await response.json()) as PresencePayload;
    if (!payload.ok || !payload.presence) return { status: "error" };
    return {
      status: "resolved",
      presence:
        payload.presence.visibility === "visible" ? payload.presence : null,
    };
  } catch {
    return { status: "error" };
  }
}

function getTriggerElement(wrapper: HTMLSpanElement | null) {
  return wrapper?.querySelector<HTMLElement>(
    "a[href],button:not(:disabled),[tabindex]:not([tabindex='-1'])",
  );
}

function focusNextAfterTrigger(trigger: HTMLElement | null | undefined) {
  if (!trigger) {
    return;
  }

  const focusable = Array.from(
    document.querySelectorAll<HTMLElement>(
      "a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex='-1'])",
    ),
  ).filter(
    (element) =>
      !isInsidePlayerHoverCard(element) &&
      !element.hasAttribute("hidden") &&
      element.getClientRects().length > 0,
  );
  const triggerIndex = focusable.indexOf(trigger);
  const nextElement = focusable[triggerIndex + 1] ?? focusable[0];
  nextElement?.focus();
}

function isInsidePlayerHoverCard(element: HTMLElement) {
  return Boolean(element.closest("[data-player-hover-card-panel]"));
}

function LoadingLine({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-full theme-surface-muted motion-reduce:animate-none ${className}`}
    />
  );
}

export function PlayerHoverCardProvider({
  children,
  currentUserId,
}: PlayerHoverCardProviderProps) {
  return (
    <CurrentPlayerContext.Provider value={currentUserId}>
      {children}
    </CurrentPlayerContext.Provider>
  );
}

export function PlayerHoverCard({
  ariaLabel,
  children,
  className,
  player,
  title,
}: PlayerHoverCardProps) {
  const contextUserId = useContext(CurrentPlayerContext);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryLinkRef = useRef<HTMLAnchorElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const cardId = `player-card-${useId().replace(/:/g, "")}`;
  const key = playerCacheKey(player);
  const cachedPreview = player.isAnonymized
    ? null
    : getCachedPlayerProfilePreview({
        playerId: player.id,
        username: player.username,
      });
  const cachedPresenceSnapshot = player.isAnonymized
    ? { resolved: false as const, presence: null }
    : getPlayerHoverPresenceSnapshot(key);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<HoverCardPosition | null>(null);
  const [preview, setPreview] = useState<PlayerProfilePreview | null>(
    cachedPreview,
  );
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "error"
  >(cachedPreview ? "ready" : "idle");
  const [presence, setPresence] = useState<PlayerPresence | null>(
    cachedPresenceSnapshot.presence,
  );
  const [presenceState, setPresenceState] = useState<"idle" | "loading" | "ready">(
    cachedPresenceSnapshot.resolved ? "ready" : "idle",
  );

  const isCurrentUser =
    preview?.isCurrentUser ??
    Boolean(contextUserId && contextUserId === player.id);
  const profileHref = isCurrentUser
    ? "/profile"
    : `/players/${encodeURIComponent(player.username)}`;
  const identity = preview?.player ?? {
    id: player.id,
    username: player.username,
    initials: player.initials,
    avatarUrl: player.avatarUrl ?? null,
    bio: null,
  };

  function clearOpenTimer() {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function closeCard() {
    clearOpenTimer();
    clearCloseTimer();
    setOpen(false);
  }

  function openCardImmediately() {
    clearOpenTimer();
    clearCloseTimer();
    setPosition(null);
    setOpen(true);
  }

  function scheduleOpen() {
    clearCloseTimer();

    if (open || openTimerRef.current !== null) {
      return;
    }

    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setPosition(null);
      setOpen(true);
    }, PLAYER_HOVER_OPEN_DELAY_MS);
  }

  function scheduleClose() {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, PLAYER_HOVER_CLOSE_DELAY_MS);
  }

  useEffect(() => {
    setMounted(true);

    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, []);

  useEffect(() => {
    if (player.isAnonymized) {
      setPreview(null);
      setPreviewState("idle");
      setPresence(null);
      setPresenceState("idle");
      setOpen(false);
      return;
    }

    const cached = getCachedPlayerProfilePreview({
      playerId: player.id,
      username: player.username,
    });
    const presenceSnapshot = getPlayerHoverPresenceSnapshot(key);
    setPreview(cached);
    setPreviewState(cached ? "ready" : "idle");
    setPresence(presenceSnapshot.presence);
    setPresenceState(presenceSnapshot.resolved ? "ready" : "idle");
    setOpen(false);
  }, [key, player.id, player.isAnonymized, player.username]);

  useEffect(() => {
    if (!open || player.isAnonymized) {
      return;
    }

    let active = true;
    const cached = getCachedPlayerProfilePreview({
      playerId: player.id,
      username: player.username,
    });
    const presenceSnapshot = getPlayerHoverPresenceSnapshot(key);
    const presenceRequest = requestPlayerPresence(player);
    const previewRequest = cached ? null : requestPlayerPreview(player);

    setPresence(presenceSnapshot.presence);
    setPresenceState(presenceSnapshot.resolved ? "ready" : "loading");

    if (cached) {
      setPreview(cached);
      setPreviewState("ready");
    } else {
      setPreview(null);
      setPreviewState("loading");

      void previewRequest?.then(
        (nextPreview) => {
          if (!active) return;
          setPreview(nextPreview);
          setPreviewState("ready");
        },
        () => {
          if (active) setPreviewState("error");
        },
      );
    }

    void presenceRequest.then((result) => {
      if (!active) return;

      if (result.status === "resolved") {
        rememberPlayerHoverPresence(key, result.presence);
        setPresence(result.presence);
        setPresenceState("ready");
        return;
      }

      if (!presenceSnapshot.resolved) {
        rememberPlayerHoverPresence(key, null);
        setPresence(null);
        setPresenceState("ready");
      }
    });

    return () => {
      active = false;
    };
  }, [key, open, player.id, player.isAnonymized, player.username]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    function updatePosition() {
      const trigger = getTriggerElement(wrapperRef.current);
      const panel = panelRef.current;

      if (!trigger || !panel) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      setPosition(
        calculatePlayerHoverCardPosition({
          cardGap,
          panel: panelRect,
          trigger: triggerRect,
          viewportHeight: window.innerHeight,
          viewportPadding,
          viewportWidth: window.innerWidth,
        }),
      );
    }

    updatePosition();
    const resizeObserver = new ResizeObserver(updatePosition);

    if (panelRef.current) {
      resizeObserver.observe(panelRef.current);
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, previewState]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      const focusWasInCard = panelRef.current?.contains(document.activeElement);
      closeCard();

      if (focusWasInCard) {
        getTriggerElement(wrapperRef.current)?.focus();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  function handleTriggerPointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    lastPointerTypeRef.current = event.pointerType;

    if (
      event.pointerType === "mouse" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches
    ) {
      scheduleOpen();
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (event.key === "Tab" && !event.shiftKey && open && primaryLinkRef.current) {
      event.preventDefault();
      primaryLinkRef.current.focus();
    }
  }

  const stats = preview?.stats ?? null;
  const summaryLoading =
    previewState === "idle" ||
    previewState === "loading" ||
    presenceState === "idle" ||
    presenceState === "loading";
  const card = (
    <div
      className={`fixed z-[100] w-[min(20rem,calc(100vw-1.5rem))] ${
        position?.side === "top" ? "pb-[6px]" : "pt-[6px]"
      }`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;

        if (wrapperRef.current?.contains(nextTarget)) {
          return;
        }

        scheduleClose();
      }}
      onFocus={clearCloseTimer}
      onKeyDown={(event) => {
        if (event.key !== "Tab") {
          return;
        }

        event.preventDefault();

        if (event.shiftKey) {
          getTriggerElement(wrapperRef.current)?.focus();
          return;
        }

        const trigger = getTriggerElement(wrapperRef.current);
        closeCard();
        focusNextAfterTrigger(trigger);
      }}
      onPointerEnter={clearCloseTimer}
      onPointerLeave={scheduleClose}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div
        aria-label={`Vista previa del perfil de @${player.username}`}
        className="overflow-y-auto rounded-2xl border p-4 shadow-[0_20px_55px_rgba(2,6,23,0.24)] theme-border theme-surface"
        data-player-hover-card-panel
        id={cardId}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        style={{ maxHeight: position?.maxHeight }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar
            avatarUrl={identity.avatarUrl}
            decorative
            initials={identity.initials}
            size="medium"
            username={identity.username}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-black theme-text">
              {identity.initials}
            </p>
            <p className="truncate text-sm font-semibold theme-text-muted">
              @{identity.username}
            </p>
          </div>
        </div>

        {summaryLoading ? (
          <div
            aria-label="Cargando resumen del perfil"
            className="mt-4 space-y-4"
            role="status"
          >
            <LoadingLine className="h-2.5 w-24" />
            <div className="space-y-2">
              <LoadingLine className="h-3 w-full" />
              <LoadingLine className="h-3 w-5/6" />
            </div>
            <div className="grid grid-cols-3 gap-2 border-y py-3 theme-border">
              {["victories", "podiums", "medals"].map((item) => (
                <div className="space-y-2 text-center" key={item}>
                  <LoadingLine className="mx-auto h-4 w-8" />
                  <LoadingLine className="mx-auto h-2.5 w-12" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {presence ? (
              <div className="mt-3 min-h-5">
                <PlayerPresenceIndicator presence={presence} variant="compact" />
              </div>
            ) : null}

            <div className="mt-4">
              <p className="whitespace-pre-wrap break-words text-sm leading-5 theme-text-muted">
                {getProfileBioDisplay(identity.bio)}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-y py-3 theme-border">
              {stats ? (
                [
                  { label: "Victorias", value: stats.victories },
                  { label: "Podios", value: stats.podiums },
                  { label: "Medallas", value: "—" },
                ].map((stat) => (
                  <div className="min-w-0 text-center" key={stat.label}>
                    <p className="text-lg font-black leading-none theme-text">
                      {stat.value}
                    </p>
                    <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-wide theme-text-muted">
                      {stat.label}
                    </p>
                  </div>
                ))
              ) : (
                <p className="col-span-3 self-center text-center text-xs theme-text-muted">
                  El resumen competitivo no está disponible ahora.
                </p>
              )}
            </div>
          </>
        )}

        <Link
          aria-label={
            isCurrentUser
              ? "Ir a mi perfil"
              : `Ver perfil de @${identity.username}`
          }
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-circuit px-4 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit focus-visible:ring-offset-2 motion-reduce:transition-none"
          href={profileHref}
          ref={primaryLinkRef}
        >
          {isCurrentUser ? "Ir a mi perfil" : "Ver perfil"}
        </Link>
      </div>
    </div>
  );

  if (player.isAnonymized) {
    return (
      <span
        aria-label="Usuario eliminado"
        className={className}
        title="Usuario eliminado"
      >
        {children}
      </span>
    );
  }

  return (
    <span className="contents" ref={wrapperRef}>
      <Link
        aria-controls={open ? cardId : undefined}
        aria-expanded={open || undefined}
        aria-haspopup="dialog"
        aria-label={ariaLabel ?? `Ver perfil de @${player.username}`}
        className={className}
        href={profileHref}
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null;

          if (panelRef.current?.contains(nextTarget)) {
            return;
          }

          scheduleClose();
        }}
        onClick={(event) => event.stopPropagation()}
        onFocus={() => {
          if (lastPointerTypeRef.current !== "touch") {
            openCardImmediately();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        onPointerDown={(event) => {
          lastPointerTypeRef.current = event.pointerType;
          event.stopPropagation();
        }}
        onPointerEnter={handleTriggerPointerEnter}
        onPointerLeave={scheduleClose}
        title={title}
      >
        {children}
      </Link>
      {mounted && open ? createPortal(card, document.body) : null}
    </span>
  );
}
