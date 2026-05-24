"use client";

import { useEffect, useRef } from "react";
import { formatExactDateTime, formatRelativeTime } from "@/lib/format";
import type { ChatMessageWithPlayer } from "@/types";

type LeagueChatProps = {
  messages: ChatMessageWithPlayer[];
};

export function LeagueChat({ messages }: LeagueChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [messages.length]);

  return (
    <div className="space-y-4">
      <div
        className="max-h-96 space-y-3 overflow-y-auto rounded-lg border p-4 theme-border theme-surface-muted"
        ref={scrollRef}
      >
        {messages.map((message) => (
          <article className="flex gap-3" key={message.id}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong">
              {message.player.initials}
            </div>
            <div className="min-w-0 flex-1 rounded-lg border p-3 theme-border theme-surface">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="font-semibold theme-text">{message.player.initials}</p>
                <p className="text-xs theme-text-muted">@{message.player.username}</p>
                <time
                  className="text-xs theme-text-muted"
                  dateTime={message.createdAt}
                  title={formatExactDateTime(message.createdAt)}
                >
                  {formatRelativeTime(message.createdAt)}
                </time>
              </div>
              <p className="mt-1 text-sm leading-6 theme-text">{message.body}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-md border px-3 py-2 theme-input"
          placeholder="Escribe un comentario mock..."
        />
        <button
          className="cursor-not-allowed rounded-md px-4 py-2 text-sm font-semibold theme-surface-strong"
          disabled
          type="button"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
