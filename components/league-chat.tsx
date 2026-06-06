"use client";

import Link from "next/link";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatExactDateTime, formatRelativeTime } from "@/lib/format";
import type { LeagueChatMessage } from "@/types";

const messageLimit = 65_536;
const visibleMessageLimit = 75;
const textareaMaxHeight = 168;
const composerViewportOffset = 56;
const mobileEditLongPressMs = 520;
const mobileEditActionVisibleMs = 3500;
const mobileEditMoveTolerance = 10;

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

type ChatMessageWritePayload = {
  ok: boolean;
  code?: string;
  error?: string;
  message?: LeagueChatMessage;
};

type InlineToken =
  | { type: "text"; value: string }
  | { type: "strong" | "em"; value: string };

type TouchPressState = {
  messageId: string;
  x: number;
  y: number;
  startedAt: number;
  moved: boolean;
  longPressFired: boolean;
};

type MobileEditPlacement = "above" | "below";

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
    .slice(-visibleMessageLimit);
}

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let index = 0;

  while (index < text.length) {
    const markerIndex = text.slice(index).search(/[*_]/);

    if (markerIndex === -1) {
      tokens.push({ type: "text", value: text.slice(index) });
      break;
    }

    const absoluteMarkerIndex = index + markerIndex;
    const marker = text[absoluteMarkerIndex];
    const closingIndex = text.indexOf(marker, absoluteMarkerIndex + 1);

    if (closingIndex === -1) {
      tokens.push({ type: "text", value: text.slice(index) });
      break;
    }

    if (absoluteMarkerIndex > index) {
      tokens.push({ type: "text", value: text.slice(index, absoluteMarkerIndex) });
    }

    const value = text.slice(absoluteMarkerIndex + 1, closingIndex);

    if (value.trim()) {
      tokens.push({ type: marker === "*" ? "strong" : "em", value });
    } else {
      tokens.push({ type: "text", value: text.slice(absoluteMarkerIndex, closingIndex + 1) });
    }

    index = closingIndex + 1;
  }

  return tokens;
}

function FormattedLine({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, index) => {
        const key = `${token.type}-${index}`;

        if (token.type === "strong") {
          return <strong key={key}>{token.value}</strong>;
        }

        if (token.type === "em") {
          return <em key={key}>{token.value}</em>;
        }

        return <span key={key}>{token.value}</span>;
      })}
    </>
  );
}

function FormattedMessage({ content, isOwn }: { content: string; isOwn: boolean }) {
  return (
    <div className="mt-1 space-y-1 break-words text-sm leading-5">
      {content.split(/\r?\n/).map((line, index) => {
        const key = `${index}-${line}`;
        const quoteMatch = line.match(/^>\s?(.*)$/);

        if (quoteMatch) {
          return (
            <blockquote
              className={
                isOwn
                  ? "border-l-2 border-white/55 pl-2 text-white/80"
                  : "border-l-2 border-[var(--muted-border)] pl-2 theme-text-muted"
              }
              key={key}
            >
              <FormattedLine text={quoteMatch[1]} />
            </blockquote>
          );
        }

        return (
          <p className={isOwn ? "text-white" : "theme-text"} key={key}>
            {line ? <FormattedLine text={line} /> : <br />}
          </p>
        );
      })}
    </div>
  );
}

function ExternalAvatar({ message }: { message: LeagueChatMessage }) {
  if (message.author?.avatarUrl) {
    return (
      <img
        alt=""
        className="mt-1 h-7 w-7 shrink-0 rounded-full border object-cover theme-border"
        src={message.author.avatarUrl}
      />
    );
  }

  return (
    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-black theme-border theme-surface theme-text">
      {message.author?.initials ?? "???"}
    </div>
  );
}

function MaskIcon({
  className,
  src,
}: {
  className: string;
  src: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{
        WebkitMask: `url('${src}') center / contain no-repeat`,
        mask: `url('${src}') center / contain no-repeat`,
      }}
    />
  );
}

export function LeagueChat({
  messages,
  canPost = false,
  currentUserId = null,
  error = null,
}: LeagueChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatShellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottom = useRef(true);
  const longPressTimerRef = useRef<number | null>(null);
  const mobileEditHideTimerRef = useRef<number | null>(null);
  const touchPressRef = useRef<TouchPressState | null>(null);
  const mobileEditMessageIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState(() => normalizeMessages(messages));
  const [messageError, setMessageError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [isSending, setIsSending] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [draftBeforeEdit, setDraftBeforeEdit] = useState<string | null>(null);
  const [mobileEditMessageId, setMobileEditMessageId] = useState<string | null>(null);
  const [mobileEditPlacement, setMobileEditPlacement] =
    useState<MobileEditPlacement>("above");
  const [hasFineHover, setHasFineHover] = useState(false);

  const editableMessageId = (() => {
    if (!currentUserId) {
      return null;
    }

    const editCutoff = now.getTime() - 15 * 60 * 1000;

    for (let index = localMessages.length - 1; index >= 0; index -= 1) {
      const message = localMessages[index];

      if (message.messageType !== "user" || message.authorId !== currentUserId) {
        continue;
      }

      const createdAt = new Date(message.createdAt).getTime();

      return Number.isFinite(createdAt) && createdAt >= editCutoff
        ? message.id
        : null;
    }

    return null;
  })();

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current === null) {
      return;
    }

    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const clearMobileEditHideTimer = useCallback(() => {
    if (mobileEditHideTimerRef.current === null) {
      return;
    }

    window.clearTimeout(mobileEditHideTimerRef.current);
    mobileEditHideTimerRef.current = null;
  }, []);

  const closeMobileEditAction = useCallback(() => {
    clearMobileEditHideTimer();
    setMobileEditMessageId(null);
  }, [clearMobileEditHideTimer]);

  const getMobileEditPlacement = useCallback((element: HTMLElement) => {
    const scrollElement = scrollRef.current;

    if (!scrollElement) {
      return "above";
    }

    const elementRect = element.getBoundingClientRect();
    const scrollRect = scrollElement.getBoundingClientRect();

    return elementRect.top - scrollRect.top < 48 ? "below" : "above";
  }, []);

  const showMobileEditAction = useCallback(
    (messageId: string, placement: MobileEditPlacement = "above") => {
      clearMobileEditHideTimer();
      setMobileEditPlacement(placement);
      setMobileEditMessageId(messageId);
      mobileEditHideTimerRef.current = window.setTimeout(() => {
        setMobileEditMessageId(null);
        mobileEditHideTimerRef.current = null;
      }, mobileEditActionVisibleMs);
    },
    [clearMobileEditHideTimer],
  );

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

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, textareaMaxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > textareaMaxHeight ? "auto" : "hidden";
  }, []);

  const keepChatBottomVisible = useCallback(() => {
    window.requestAnimationFrame(() => {
      const shell = chatShellRef.current;

      if (!shell) {
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const comfortableBottom = window.innerHeight - composerViewportOffset;
      const overflow = shellRect.bottom - comfortableBottom;

      if (overflow <= 0) {
        return;
      }

      window.scrollBy({ top: overflow, behavior: "auto" });
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
    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateInteractionMode = () => {
      setHasFineHover(mediaQuery.matches);
    };

    updateInteractionMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateInteractionMode);

      return () => {
        mediaQuery.removeEventListener("change", updateInteractionMode);
      };
    }

    mediaQuery.addListener(updateInteractionMode);

    return () => {
      mediaQuery.removeListener(updateInteractionMode);
    };
  }, []);

  useEffect(() => {
    if (!mobileEditMessageId) {
      return;
    }

    if (editingMessageId || mobileEditMessageId !== editableMessageId) {
      closeMobileEditAction();
    }
  }, [closeMobileEditAction, editableMessageId, editingMessageId, mobileEditMessageId]);

  useEffect(() => {
    mobileEditMessageIdRef.current = mobileEditMessageId;
  }, [mobileEditMessageId]);

  useEffect(() => {
    if (mobileEditMessageIdRef.current) {
      closeMobileEditAction();
    }
  }, [closeMobileEditAction, localMessages]);

  useEffect(() => {
    if (!mobileEditMessageId) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        closeMobileEditAction();
        return;
      }

      if (
        target.closest(`[data-chat-context-owner="${mobileEditMessageId}"]`) ||
        target.closest(`[data-chat-context-menu="${mobileEditMessageId}"]`)
      ) {
        return;
      }

      closeMobileEditAction();
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeMobileEditAction, mobileEditMessageId]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      clearMobileEditHideTimer();
    };
  }, [clearLongPressTimer, clearMobileEditHideTimer]);

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
          event: "*",
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

  useLayoutEffect(() => {
    resizeTextarea();

    if (document.activeElement === textareaRef.current) {
      keepChatBottomVisible();
    }
  }, [draft, keepChatBottomVisible, resizeTextarea]);

  function handleEditableMessagePointerDown(
    event: PointerEvent<HTMLDivElement>,
    message: LeagueChatMessage,
  ) {
    if (
      event.pointerType !== "touch" ||
      editingMessageId ||
      message.id !== editableMessageId
    ) {
      return;
    }

    const ownerElement = event.currentTarget;
    const placement = getMobileEditPlacement(ownerElement);

    clearLongPressTimer();
    touchPressRef.current = {
      messageId: message.id,
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
      moved: false,
      longPressFired: false,
    };

    longPressTimerRef.current = window.setTimeout(() => {
      const press = touchPressRef.current;

      if (!press || press.messageId !== message.id || press.moved) {
        return;
      }

      press.longPressFired = true;
      showMobileEditAction(message.id, placement);
    }, mobileEditLongPressMs);
  }

  function handleEditableMessagePointerMove(event: PointerEvent<HTMLDivElement>) {
    const press = touchPressRef.current;

    if (!press || event.pointerType !== "touch") {
      return;
    }

    const distanceX = Math.abs(event.clientX - press.x);
    const distanceY = Math.abs(event.clientY - press.y);

    if (distanceX > mobileEditMoveTolerance || distanceY > mobileEditMoveTolerance) {
      press.moved = true;
      clearLongPressTimer();
    }
  }

  function handleEditableMessagePointerUp(event: PointerEvent<HTMLDivElement>) {
    const press = touchPressRef.current;

    if (!press || event.pointerType !== "touch") {
      return;
    }

    clearLongPressTimer();
    touchPressRef.current = null;

    if (
      press.moved ||
      press.longPressFired ||
      editingMessageId ||
      press.messageId !== editableMessageId
    ) {
      return;
    }

    showMobileEditAction(
      press.messageId,
      getMobileEditPlacement(event.currentTarget),
    );
  }

  function handleEditableMessagePointerCancel() {
    clearLongPressTimer();
    touchPressRef.current = null;
  }

  function focusComposer() {
    window.requestAnimationFrame(() => {
      resizeTextarea();
      textareaRef.current?.focus();
      keepChatBottomVisible();
    });
  }

  function startEditing(message: LeagueChatMessage) {
    if (message.id !== editableMessageId || isSending) {
      return;
    }

    closeMobileEditAction();
    setDraftBeforeEdit(draft);
    setEditingMessageId(message.id);
    setDraft(message.content);
    setMessageError(null);
    focusComposer();
  }

  function cancelEditing() {
    closeMobileEditAction();
    setEditingMessageId(null);
    setDraft(draftBeforeEdit ?? "");
    setDraftBeforeEdit(null);
    setMessageError(null);
    focusComposer();
  }

  async function sendMessage() {
    const content = draft.trim();
    const isEditing = Boolean(editingMessageId);

    if (isSending || !canPost) {
      return;
    }

    if (!content) {
      setMessageError("Escribe un mensaje antes de enviar.");
      textareaRef.current?.focus();
      return;
    }

    if (content.length > messageLimit) {
      setMessageError("El mensaje no puede superar 65.536 caracteres.");
      textareaRef.current?.focus();
      return;
    }

    shouldStickToBottom.current = true;
    setMessageError(null);
    closeMobileEditAction();
    setIsSending(true);

    try {
      const response = await fetch(
        isEditing
          ? `/api/chat/messages/${encodeURIComponent(editingMessageId as string)}`
          : "/api/chat/messages",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const payload = (await response.json()) as ChatMessageWritePayload;

      if (!response.ok || !payload.ok || !payload.message) {
        console.error("Chat send failed", payload.error);

        if (payload.code === "MESSAGE_NOT_EDITABLE") {
          setMessageError("Solo puedes editar tu último mensaje durante 15 minutos.");
          return;
        }

        if (isEditing) {
          setMessageError(
            payload.error === "El mensaje no puede superar 65.536 caracteres."
              ? payload.error
              : "No se pudo editar el mensaje. Inténtalo de nuevo.",
          );
          return;
        }

        setMessageError(
          payload.error === "El mensaje no puede superar 65.536 caracteres."
            ? payload.error
            : "No se pudo enviar el mensaje. Inténtalo de nuevo.",
        );
        return;
      }

      setDraft("");
      setEditingMessageId(null);
      setDraftBeforeEdit(null);
      setLocalMessages((current) =>
        normalizeMessages(
          isEditing
            ? current.map((message) =>
                message.id === payload.message?.id
                  ? (payload.message as LeagueChatMessage)
                  : message,
              )
            : [...current, payload.message as LeagueChatMessage],
        ),
      );
      window.requestAnimationFrame(() => {
        resizeTextarea();
        textareaRef.current?.focus();
        scrollToBottom("auto");
        keepChatBottomVisible();
      });
    } catch (sendError) {
      console.error("Chat send failed", sendError);
      setMessageError("No se pudo enviar el mensaje. Inténtalo de nuevo.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && editingMessageId) {
      event.preventDefault();
      cancelEditing();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  return (
    <div className="space-y-4" ref={chatShellRef}>
      {error ? (
        <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-text)]">
          No se pudo cargar el chat. Prueba a recargar la página.
        </div>
      ) : null}
      <div
        className="h-96 space-y-3 overflow-x-hidden overflow-y-auto rounded-lg border p-4 theme-border theme-surface-muted"
        onScroll={() => {
          shouldStickToBottom.current = isNearBottom(scrollRef.current);
          if (mobileEditMessageIdRef.current) {
            closeMobileEditAction();
          }
        }}
        ref={scrollRef}
      >
        {localMessages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-5 text-center theme-border theme-surface">
            <p className="font-semibold theme-text">Todavía no hay mensajes.</p>
            <p className="mt-2 text-sm theme-text-muted">
              El chat mostrará los últimos 75 mensajes de la liga.
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
            const canEditMessage =
              !editingMessageId && isOwn && message.id === editableMessageId;
            const isMobileEditActionOpen =
              canEditMessage && mobileEditMessageId === message.id;
            const bubble = (
              <div
                className={
                  isOwn
                    ? "w-fit min-w-0 max-w-full rounded-lg border border-circuit/40 bg-circuit px-3 py-2 text-white"
                    : "min-w-0 max-w-[82%] rounded-lg border px-3 py-2 theme-border theme-surface"
                }
              >
                <div
                  className={
                    isOwn
                      ? "flex min-w-0 items-center justify-between gap-3 text-white"
                      : "flex min-w-0 items-center justify-between gap-3"
                  }
                >
                  <p
                    className={
                      isOwn
                        ? "shrink-0 text-xs font-black uppercase leading-none text-white"
                        : "min-w-0 truncate text-xs font-black uppercase leading-none theme-text"
                    }
                  >
                    {isOwn ? "YOU" : (message.author?.initials ?? "???")}
                  </p>
                  <div
                    className={
                      isOwn
                        ? "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs leading-none text-white/75"
                        : "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs leading-none theme-text-muted"
                    }
                  >
                    {message.editedAt ? (
                      <span aria-label="Editado" role="img" title="Editado">
                        <MaskIcon
                          className={
                            isOwn ? "h-3.5 w-3.5 bg-white" : "h-3.5 w-3.5 bg-current"
                          }
                          src="/icons/chat-edited.png"
                        />
                      </span>
                    ) : null}
                    <time
                      dateTime={message.createdAt}
                      title={formatExactDateTime(message.createdAt)}
                    >
                      {formatRelativeTime(message.createdAt, now)}
                    </time>
                  </div>
                </div>
                <FormattedMessage content={message.content} isOwn={isOwn} />
              </div>
            );

            return (
              <article
                className={isOwn ? "flex justify-end" : "flex justify-start gap-2"}
                key={message.id}
              >
                {!isOwn ? <ExternalAvatar message={message} /> : null}
                {isOwn ? (
                  <div
                    className="group/message flex w-full max-w-full min-w-0 flex-col items-end"
                    data-chat-context-owner={message.id}
                    onPointerCancel={handleEditableMessagePointerCancel}
                    onPointerDown={(event) => {
                      handleEditableMessagePointerDown(event, message);
                    }}
                    onPointerMove={handleEditableMessagePointerMove}
                    onPointerUp={handleEditableMessagePointerUp}
                  >
                    <div className="flex w-full max-w-full min-w-0 items-end justify-end gap-2">
                      {canEditMessage && hasFineHover ? (
                        <button
                          aria-label="Editar mensaje"
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-circuit/30 bg-circuit/95 text-ink opacity-0 shadow-sm transition hover:bg-circuit focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit group-hover/message:opacity-100 group-focus-within/message:opacity-100"
                          onClick={() => {
                            startEditing(message);
                          }}
                          type="button"
                        >
                          <MaskIcon className="h-4 w-4 bg-white" src="/icons/chat-edit.png" />
                        </button>
                      ) : null}
                      <div className="relative w-fit max-w-[82%]">
                        {bubble}
                        {isMobileEditActionOpen ? (
                          <button
                            aria-label="Editar mensaje"
                            className={`absolute right-2 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-ink/95 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-black/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
                              mobileEditPlacement === "below"
                                ? "top-[calc(100%+0.35rem)]"
                                : "bottom-[calc(100%+0.35rem)]"
                            }`}
                            data-chat-context-menu={message.id}
                            onClick={() => {
                              startEditing(message);
                            }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            type="button"
                          >
                            <MaskIcon className="h-3.5 w-3.5 bg-white" src="/icons/chat-edit.png" />
                            Editar
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : (
                  bubble
                )}
              </article>
            );
          })
        )}
      </div>
      {editingMessageId ? (
        <p className="text-xs font-medium theme-text-muted">
          {hasFineHover
            ? "Edita tu mensaje (Esc para cancelar)..."
            : "Edita tu mensaje..."}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          className="min-h-11 min-w-0 flex-1 resize-none rounded-md border px-3 py-2 text-sm leading-5 theme-input disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPost}
          maxLength={messageLimit}
          onChange={(event) => {
            closeMobileEditAction();
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={canPost ? "Escribe un mensaje..." : "Inicia sesión para escribir..."}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        {editingMessageId ? (
          <button
            aria-label="Cancelar edición"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition theme-border theme-surface theme-text hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSending}
            onClick={cancelEditing}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            type="button"
          >
            <MaskIcon className="h-6 w-6 bg-current" src="/icons/chat-cancel.png" />
            <span className="sr-only">Cancelar edición</span>
          </button>
        ) : null}
        <button
          aria-label={editingMessageId ? "Guardar edición" : "Enviar"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-circuit text-ink transition hover:bg-circuit/90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!canPost || isSending || draft.trim().length === 0}
          onClick={() => void sendMessage()}
          type="button"
        >
          <img alt="" className="h-5 w-5 object-contain" src="/icons/send.png" />
          <span className="sr-only">{editingMessageId ? "Guardar edición" : "Enviar"}</span>
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
