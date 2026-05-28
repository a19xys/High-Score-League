"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatExactDateTime, formatRelativeTime } from "@/lib/format";
import type { LeagueChatMessage } from "@/types";

type LeagueChatProps = {
  messages: LeagueChatMessage[];
  canPost?: boolean;
  currentUserId?: string | null;
  error?: string | null;
  mode?: "mock" | "supabase";
};

type ChatMessagesPayload = {
  ok: boolean;
  error?: string;
  messages?: LeagueChatMessage[];
};

function normalizeMessages(messages: LeagueChatMessage[]) {
  const byId = new Map<string, LeagueChatMessage>();

  for (const message of messages) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values())
    .sort((a, b) => {
      const dateOrder =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

      return dateOrder || a.id.localeCompare(b.id);
    })
    .slice(-50);
}

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function MessageAvatar({
  message,
  isOwn,
}: {
  message: LeagueChatMessage;
  isOwn: boolean;
}) {
  return (
    <div
      className={
        isOwn
          ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-circuit text-xs font-bold text-white"
          : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong"
      }
    >
      {message.author?.initials ?? "???"}
    </div>
  );
}

export function LeagueChat({
  messages,
  canPost = false,
  currentUserId = null,
  error = null,
  mode = "mock",
}: LeagueChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState(() => normalizeMessages(messages));
  const [messageError, setMessageError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [isPending, startTransition] = useTransition();

  const refreshMessages = useCallback(async () => {
    shouldStickToBottom.current = isNearBottom(scrollRef.current);

    const response = await fetch("/api/chat/messages", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json()) as ChatMessagesPayload;

    if (!response.ok || !payload.ok || !payload.messages) {
      setMessageError(payload.error ?? "No se pudo actualizar el chat.");
      return;
    }

    setLocalMessages(normalizeMessages(payload.messages));
  }, []);

  useEffect(() => {
    shouldStickToBottom.current = isNearBottom(scrollRef.current);
    setLocalMessages(normalizeMessages(messages));
  }, [messages]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (mode !== "supabase" || !canPost) {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel("league-chat-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "league_chat_messages",
        },
        () => {
          void refreshMessages();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canPost, mode, refreshMessages]);

  useEffect(() => {
    if (mode !== "supabase" || !canPost) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshMessages();
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [canPost, mode, refreshMessages]);

  useEffect(() => {
    if (!shouldStickToBottom.current) {
      return;
    }

    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "auto",
    });
  }, [localMessages.length]);

  function sendMessage() {
    const content = draft.trim();

    if (!content) {
      setMessageError("Escribe un mensaje antes de enviar.");
      return;
    }

    shouldStickToBottom.current = true;
    setMessageError(null);
    startTransition(async () => {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        message?: LeagueChatMessage;
      };

      if (!response.ok || !payload.ok || !payload.message) {
        setMessageError(payload.error ?? "No se pudo enviar el mensaje.");
        return;
      }

      setDraft("");
      setLocalMessages((current) =>
        normalizeMessages([...current, payload.message as LeagueChatMessage]),
      );
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          {error}
        </div>
      ) : null}
      <div
        className="h-96 space-y-3 overflow-y-auto rounded-lg border p-4 theme-border theme-surface-muted"
        onScroll={() => {
          shouldStickToBottom.current = isNearBottom(scrollRef.current);
        }}
        ref={scrollRef}
      >
        {localMessages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-center theme-border theme-surface">
            <p className="font-semibold theme-text">Todavía no hay mensajes.</p>
            <p className="mt-2 text-sm theme-text-muted">
              El chat mostrará los últimos 50 mensajes de la liga.
            </p>
          </div>
        ) : (
          localMessages.map((message) => {
            if (message.messageType === "system") {
              return (
                <article className="flex justify-center" key={message.id}>
                  <time
                    className="max-w-[85%] rounded-full border px-3 py-1 text-center text-xs font-medium theme-border theme-surface"
                    dateTime={message.createdAt}
                    title={formatExactDateTime(message.createdAt)}
                  >
                    {message.content}
                  </time>
                </article>
              );
            }

            const isOwn = Boolean(currentUserId && message.authorId === currentUserId);

            return (
              <article
                className={isOwn ? "flex flex-row-reverse gap-3" : "flex gap-3"}
                key={message.id}
              >
                <MessageAvatar isOwn={isOwn} message={message} />
                <div
                  className={
                    isOwn
                      ? "min-w-0 max-w-[82%] flex-1 rounded-lg border border-circuit/40 bg-circuit p-3 text-white"
                      : "min-w-0 max-w-[82%] flex-1 rounded-lg border p-3 theme-border theme-surface"
                  }
                >
                  <div
                    className={
                      isOwn
                        ? "flex flex-wrap items-baseline gap-2 text-white"
                        : "flex flex-wrap items-baseline gap-2"
                    }
                  >
                    <p
                      className={
                        isOwn ? "font-semibold text-white" : "font-semibold theme-text"
                      }
                    >
                      {message.author?.initials ?? "???"}
                    </p>
                    <p
                      className={
                        isOwn ? "text-xs text-white/75" : "text-xs theme-text-muted"
                      }
                    >
                      @{message.author?.username ?? "desconocido"}
                    </p>
                    <time
                      className={
                        isOwn ? "text-xs text-white/75" : "text-xs theme-text-muted"
                      }
                      dateTime={message.createdAt}
                      title={formatExactDateTime(message.createdAt)}
                    >
                      {formatRelativeTime(message.createdAt, now)}
                    </time>
                  </div>
                  <p
                    className={
                      isOwn
                        ? "mt-1 text-sm leading-6 text-white"
                        : "mt-1 text-sm leading-6 theme-text"
                    }
                  >
                    {message.content}
                  </p>
                </div>
              </article>
            );
          })
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          className="min-w-0 flex-1 rounded-md border px-3 py-2 theme-input disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPost || isPending}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && canPost && !isPending) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            canPost
              ? "Escribe un comentario..."
              : mode === "supabase"
                ? "Inicia sesión para escribir..."
                : "Chat mock sin envío real..."
          }
          value={draft}
        />
        <button
          className="rounded-md px-4 py-2 text-sm font-semibold theme-surface-strong disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPost || isPending}
          onClick={sendMessage}
          type="button"
        >
          {isPending ? "Enviando..." : "Enviar"}
        </button>
      </div>
      {!canPost && mode === "supabase" ? (
        <p className="text-sm theme-text-muted">
          <Link className="font-semibold text-circuit hover:underline" href="/login">
            Inicia sesión
          </Link>{" "}
          para participar en el chat.
        </p>
      ) : null}
      {messageError ? (
        <p className="text-sm text-[var(--warning-text)]">{messageError}</p>
      ) : null}
    </div>
  );
}
