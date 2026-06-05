"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatExactDateTime, formatRelativeTime } from "@/lib/format";
import type { LeagueChatMessage } from "@/types";

const messageLimit = 2000;

type LeagueChatProps = {
  messages: LeagueChatMessage[];
  canPost?: boolean;
  currentUserId?: string | null;
  error?: string | null;
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

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M4.5 19.5 20 12 4.5 4.5l2.1 6.3L13 12l-6.4 1.2-2.1 6.3Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function LeagueChat({
  messages,
  canPost = false,
  currentUserId = null,
  error = null,
}: LeagueChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottom = useRef(true);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState(() => normalizeMessages(messages));
  const [messageError, setMessageError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [isSending, setIsSending] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
  }, []);

  const refreshMessages = useCallback(async () => {
    shouldStickToBottom.current = isNearBottom(scrollRef.current);

    try {
      const response = await fetch("/api/chat/messages", {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.status === 401) {
        return;
      }

      const payload = (await response.json()) as ChatMessagesPayload;

      if (!response.ok || !payload.ok || !payload.messages) {
        console.error("Chat refresh failed", payload.error);
        setMessageError("No se pudo cargar el chat. Prueba a recargar la página.");
        return;
      }

      setLocalMessages(normalizeMessages(payload.messages));
    } catch (refreshError) {
      console.error("Chat refresh failed", refreshError);
      setMessageError("No se pudo cargar el chat. Prueba a recargar la página.");
    }
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
    if (!canPost) {
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
  }, [canPost, refreshMessages]);

  useEffect(() => {
    if (!canPost) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshMessages();
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [canPost, refreshMessages]);

  useLayoutEffect(() => {
    if (!shouldStickToBottom.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom("auto");
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [localMessages.length, scrollToBottom]);

  async function sendMessage() {
    const content = draft.trim();

    if (isSending || !canPost) {
      return;
    }

    if (!content) {
      setMessageError("Escribe un mensaje antes de enviar.");
      textareaRef.current?.focus();
      return;
    }

    if (content.length > messageLimit) {
      setMessageError("El mensaje no puede superar 2000 caracteres.");
      textareaRef.current?.focus();
      return;
    }

    shouldStickToBottom.current = true;
    setMessageError(null);
    setIsSending(true);

    try {
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
        console.error("Chat send failed", payload.error);
        setMessageError(
          payload.error === "El mensaje no puede superar 2000 caracteres."
            ? payload.error
            : "No se pudo enviar el mensaje. Inténtalo de nuevo.",
        );
        return;
      }

      setDraft("");
      setLocalMessages((current) =>
        normalizeMessages([...current, payload.message as LeagueChatMessage]),
      );
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        scrollToBottom("auto");
      });
    } catch (sendError) {
      console.error("Chat send failed", sendError);
      setMessageError("No se pudo enviar el mensaje. Inténtalo de nuevo.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          No se pudo cargar el chat. Prueba a recargar la página.
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
                className={isOwn ? "flex justify-end" : "flex justify-start"}
                key={message.id}
              >
                <div
                  className={
                    isOwn
                      ? "min-w-0 max-w-[88%] rounded-lg border border-circuit/40 bg-circuit px-3 py-2 text-white"
                      : "min-w-0 max-w-[88%] rounded-lg border px-3 py-2 theme-border theme-surface"
                  }
                >
                  <div
                    className={
                      isOwn
                        ? "flex items-baseline justify-between gap-4 text-white"
                        : "flex items-baseline justify-between gap-4"
                    }
                  >
                    <p
                      className={
                        isOwn
                          ? "text-xs font-black uppercase text-white"
                          : "text-xs font-black uppercase theme-text"
                      }
                    >
                      {message.author?.initials ?? "???"}
                    </p>
                    <time
                      className={
                        isOwn
                          ? "shrink-0 text-xs text-white/75"
                          : "shrink-0 text-xs theme-text-muted"
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
                        ? "mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-white"
                        : "mt-1 whitespace-pre-wrap break-words text-sm leading-5 theme-text"
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
      <div className="flex items-end gap-2">
        <textarea
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-y rounded-md border px-3 py-2 text-sm leading-5 theme-input disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPost}
          maxLength={messageLimit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={canPost ? "Escribe un comentario..." : "Inicia sesión para escribir..."}
          ref={textareaRef}
          rows={2}
          value={draft}
        />
        <button
          aria-label="Enviar"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-circuit text-ink transition hover:bg-circuit/90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPost || isSending || draft.trim().length === 0}
          onClick={() => void sendMessage()}
          type="button"
        >
          <SendIcon />
          <span className="sr-only">Enviar</span>
        </button>
      </div>
      {!canPost ? (
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
