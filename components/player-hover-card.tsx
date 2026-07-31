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
import type { PlayerProfilePreview } from "@/lib/data/player-profile-preview";
import type { Player } from "@/types";

const hoverOpenDelayMs = 600;
const viewportPadding = 12;
const cardGap = 8;

const previewCache = new Map<string, PlayerProfilePreview>();
const previewRequests = new Map<string, Promise<PlayerProfilePreview>>();
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

type CardPosition = {
  left: number;
  side: "top" | "bottom";
  top: number;
};

type PreviewPayload = {
  ok: boolean;
  preview?: PlayerProfilePreview;
};

function playerCacheKey(player: Player) {
  return player.id || player.username;
}

async function requestPlayerPreview(player: Player) {
  const key = playerCacheKey(player);
  const cached = previewCache.get(key);

  if (cached) {
    return cached;
  }

  const pending = previewRequests.get(key);

  if (pending) {
    return pending;
  }

  const request = fetch(
    `/api/players/${encodeURIComponent(player.username)}/preview`,
    {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  ).then(async (response) => {
    if (!response.ok) {
      throw new Error("player-preview-unavailable");
    }

    const payload = (await response.json()) as PreviewPayload;

    if (!payload.ok || !payload.preview) {
      throw new Error("player-preview-invalid");
    }

    previewCache.set(key, payload.preview);
    return payload.preview;
  });

  previewRequests.set(key, request);
  void request.then(
    () => previewRequests.delete(key),
    () => previewRequests.delete(key),
  );

  return request;
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
  const cachedPreview = previewCache.get(key) ?? null;
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CardPosition | null>(null);
  const [preview, setPreview] = useState<PlayerProfilePreview | null>(
    cachedPreview,
  );
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "ready" | "error"
  >(cachedPreview ? "ready" : "idle");

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
    }, hoverOpenDelayMs);
  }

  function scheduleImmediateClose() {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 0);
  }

  useEffect(() => {
    setMounted(true);

    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, []);

  useEffect(() => {
    const cached = previewCache.get(key) ?? null;
    setPreview(cached);
    setPreviewState(cached ? "ready" : "idle");
    setOpen(false);
  }, [key]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const cached = previewCache.get(key);

    if (cached) {
      setPreview(cached);
      setPreviewState("ready");
      return;
    }

    let active = true;
    setPreviewState("loading");

    void requestPlayerPreview(player).then(
      (nextPreview) => {
        if (!active) {
          return;
        }

        setPreview(nextPreview);
        setPreviewState("ready");
      },
      () => {
        if (active) {
          setPreviewState("error");
        }
      },
    );

    return () => {
      active = false;
    };
  }, [key, open, player]);

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
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
      const spaceAbove = triggerRect.top - viewportPadding;
      const side =
        spaceBelow >= panelRect.height + cardGap || spaceBelow >= spaceAbove
          ? "bottom"
          : "top";
      const idealLeft =
        triggerRect.left + triggerRect.width / 2 - panelRect.width / 2;
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - panelRect.width - viewportPadding,
      );
      const left = Math.min(Math.max(viewportPadding, idealLeft), maxLeft);
      const top =
        side === "bottom"
          ? Math.min(
              triggerRect.bottom,
              window.innerHeight - panelRect.height - cardGap - viewportPadding,
            )
          : Math.max(
              viewportPadding,
              triggerRect.top - panelRect.height - cardGap,
            );

      setPosition({ left, side, top });
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
  const card = (
    <div
      className={`fixed z-[100] w-[min(20rem,calc(100vw-1.5rem))] ${
        position?.side === "top" ? "pb-2" : "pt-2"
      }`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;

        if (wrapperRef.current?.contains(nextTarget)) {
          return;
        }

        scheduleImmediateClose();
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
      onPointerLeave={scheduleImmediateClose}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      <div
        aria-label={`Vista previa del perfil de @${player.username}`}
        className="max-h-[calc(100vh-1.5rem)] min-h-[15.5rem] overflow-y-auto rounded-2xl border p-4 shadow-[0_20px_55px_rgba(2,6,23,0.24)] theme-border theme-surface"
        data-player-hover-card-panel
        id={cardId}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
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

        <div className="mt-4 min-h-[3.75rem]">
          {previewState === "loading" ? (
            <div
              aria-label="Cargando resumen del perfil"
              className="space-y-2"
              role="status"
            >
              <LoadingLine className="h-3 w-full" />
              <LoadingLine className="h-3 w-5/6" />
              <LoadingLine className="h-3 w-2/3" />
            </div>
          ) : (
            <p className="[display:-webkit-box] overflow-hidden text-sm leading-5 theme-text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
              {identity.bio?.trim() ||
                (isCurrentUser
                  ? "Aún no has añadido una bio pública."
                  : "Este jugador aún no ha añadido una bio pública.")}
            </p>
          )}
        </div>

        <div className="mt-4 grid min-h-[3.75rem] grid-cols-3 gap-2 border-y py-3 theme-border">
          {previewState === "loading" ? (
            ["victories", "podiums", "results"].map((item) => (
              <div className="space-y-2 text-center" key={item}>
                <LoadingLine className="mx-auto h-4 w-8" />
                <LoadingLine className="mx-auto h-2.5 w-12" />
              </div>
            ))
          ) : stats ? (
            [
              { label: "Victorias", value: stats.victories },
              { label: "Podios", value: stats.podiums },
              { label: "Resultados", value: stats.officialResults },
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

        <p className="mt-3 text-xs font-bold text-circuit">
          {isCurrentUser
            ? "Este eres tú · Tu trayectoria competitiva"
            : "Trayectoria competitiva"}
        </p>
        <Link
          aria-label={
            isCurrentUser
              ? "Ir a mi perfil"
              : `Ver perfil de @${identity.username}`
          }
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-circuit px-4 py-2 text-sm font-extrabold text-slate-950 transition hover:bg-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit focus-visible:ring-offset-2 motion-reduce:transition-none"
          href={profileHref}
          ref={primaryLinkRef}
        >
          {isCurrentUser ? "Ir a mi perfil" : "Ver perfil"}
        </Link>
      </div>
    </div>
  );

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

          scheduleImmediateClose();
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
        onPointerLeave={scheduleImmediateClose}
        title={title}
      >
        {children}
      </Link>
      {mounted && open ? createPortal(card, document.body) : null}
    </span>
  );
}
