"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatExactDateTime, formatRelativeTime } from "@/lib/format";
import type { LeagueChatMessage } from "@/types";

type LeagueChatProps = {
  messages: LeagueChatMessage[];
  canPost?: boolean;
  error?: string | null;
  mode?: "mock" | "supabase";
};

function MessageAvatar({ message }: { message: LeagueChatMessage }) {
  if (message.messageType === "system") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong">
        SYS
      </div>
    );
  }

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold theme-surface-strong">
      {message.author?.initials ?? "???"}
    </div>
  );
}

export function LeagueChat({
  messages,
  canPost = false,
  error = null,
  mode = "mock",
}: LeagueChatProps) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState(messages);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  useEffect(() => {
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
      setLocalMessages((current) => [...current, payload.message as LeagueChatMessage].slice(-50));
      router.refresh();
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
        className="max-h-96 space-y-3 overflow-y-auto rounded-lg border p-4 theme-border theme-surface-muted"
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
          localMessages.map((message) => (
            <article
              className={
                message.messageType === "system"
                  ? "flex gap-3 opacity-90"
                  : "flex gap-3"
              }
              key={message.id}
            >
              <MessageAvatar message={message} />
              <div
                className={
                  message.messageType === "system"
                    ? "min-w-0 flex-1 rounded-lg border border-dashed p-3 theme-border theme-surface-muted"
                    : "min-w-0 flex-1 rounded-lg border p-3 theme-border theme-surface"
                }
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  {message.messageType === "system" ? (
                    <p className="font-semibold theme-text">Sistema</p>
                  ) : (
                    <>
                      <p className="font-semibold theme-text">
                        {message.author?.initials ?? "???"}
                      </p>
                      <p className="text-xs theme-text-muted">
                        @{message.author?.username ?? "desconocido"}
                      </p>
                    </>
                  )}
                  <time
                    className="text-xs theme-text-muted"
                    dateTime={message.createdAt}
                    title={formatExactDateTime(message.createdAt)}
                  >
                    {formatRelativeTime(message.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-sm leading-6 theme-text">{message.content}</p>
              </div>
            </article>
          ))
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
