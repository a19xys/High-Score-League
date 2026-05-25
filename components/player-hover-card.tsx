"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Player } from "@/types";

type PlayerHoverCardProps = {
  player: Player;
};

type CardPosition = {
  left: number;
  top: number;
};

export function PlayerHoverCard({ player }: PlayerHoverCardProps) {
  const avatarRef = useRef<HTMLAnchorElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CardPosition>({ left: 0, top: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updatePosition() {
      const rect = avatarRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const cardWidth = 224;
      const viewportPadding = 12;
      const centeredLeft = rect.left + rect.width / 2 - cardWidth / 2;

      setPosition({
        left: Math.min(
          Math.max(viewportPadding, centeredLeft),
          window.innerWidth - cardWidth - viewportPadding,
        ),
        top: rect.bottom + 8,
      });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function showCard() {
    clearCloseTimer();
    setOpen(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  const card = (
    <div
      className="fixed z-50 w-56 rounded-lg border p-4 shadow-panel theme-border theme-surface"
      onMouseEnter={showCard}
      onMouseLeave={scheduleClose}
      style={{ left: position.left, top: position.top }}
    >
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
        className="mt-3 inline-flex rounded-md px-3 py-2 text-sm font-semibold theme-surface-strong"
        href={`/players/${player.username}`}
      >
        Ver perfil
      </Link>
    </div>
  );

  return (
    <>
      <Link
        className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold theme-surface-strong"
        href={`/players/${player.username}`}
        onFocus={showCard}
        onBlur={scheduleClose}
        onMouseEnter={showCard}
        onMouseLeave={scheduleClose}
        ref={avatarRef}
        title={`${player.initials} · @${player.username}`}
      >
        {player.initials}
      </Link>
      {mounted && open ? createPortal(card, document.body) : null}
    </>
  );
}
