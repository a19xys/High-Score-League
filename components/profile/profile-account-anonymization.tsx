"use client";

import { useEffect, useRef, useState } from "react";
import { invalidatePlayerProfilePreview } from "@/lib/player-profile-preview-cache";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  playerId: string;
  username: string;
};

type ErrorPayload = {
  error?: string;
};

export function ProfileAccountAnonymization({ playerId, username }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const canConfirm =
    confirmation === username && acknowledged && !submitting;

  useEffect(() => {
    if (!open) {
      return;
    }

    inputRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submittingRef.current) {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),[href],[tabindex]:not([tabindex='-1'])",
        ),
      );

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1) as HTMLElement;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function closeDialog() {
    if (submittingRef.current) {
      return;
    }

    setOpen(false);
    setConfirmation("");
    setAcknowledged(false);
    setError(null);
    triggerRef.current?.focus();
  }

  async function confirmDeletion() {
    if (!canConfirm || submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/profile/anonymize", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, acknowledged: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as ErrorPayload;

      if (!response.ok) {
        setError(payload.error ?? "No se pudo completar la eliminación.");
        return;
      }

      invalidatePlayerProfilePreview({ playerId, usernames: [username] });
      await createSupabaseBrowserClient()?.auth.signOut({ scope: "local" });
      window.location.assign("/");
    } catch {
      setError("No se pudo conectar con el servicio. Inténtalo de nuevo.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--destructive-border)] px-4 py-3 text-sm font-semibold text-[var(--destructive-text)] transition hover:bg-[var(--destructive-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--destructive-border)]"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        Eliminar mi cuenta
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            aria-describedby="account-deletion-description"
            aria-labelledby="account-deletion-title"
            aria-modal="true"
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border p-5 shadow-2xl theme-border theme-surface sm:p-7"
            ref={dialogRef}
            role="dialog"
          >
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[var(--warning-text)]">
              Acción irreversible
            </p>
            <h3 className="mt-1 text-2xl font-black theme-text" id="account-deletion-title">
              Eliminar mi cuenta
            </h3>
            <div
              className="mt-4 space-y-4 text-sm leading-6 theme-text-muted"
              id="account-deletion-description"
            >
              <p>
                Se eliminarán tu username actual, siglas, avatar, bio, acceso a la cuenta y Playtime personal.
              </p>
              <p>
                Tu historia permanecerá anónima: submissions, puntuaciones, resultados, puntos, puestos, participaciones, mensajes, comentarios y votos ya emitidos.
              </p>
              <p className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-[var(--warning-text)]">
                Tus mensajes y comentarios conservarán su texto original, pero aparecerán asociados a una identidad anónima. La información personal escrita dentro de ese texto no se modificará automáticamente.
              </p>
            </div>

            <label className="mt-5 block" htmlFor="account-deletion-username">
              <span className="text-sm font-bold theme-text">
                Escribe <strong>@{username}</strong> para confirmar
              </span>
              <input
                autoComplete="off"
                className="mt-2 w-full rounded-xl border px-3 py-2.5 theme-input"
                id="account-deletion-username"
                onChange={(event) => setConfirmation(event.target.value)}
                ref={inputRef}
                spellCheck={false}
                value={confirmation}
              />
            </label>

            <label className="mt-4 flex items-start gap-3 rounded-xl border p-3 theme-border theme-surface-muted">
              <input
                checked={acknowledged}
                className="mt-1 h-4 w-4 accent-circuit"
                onChange={(event) => setAcknowledged(event.target.checked)}
                type="checkbox"
              />
              <span className="text-sm font-semibold theme-text">
                Entiendo que esta acción es irreversible.
              </span>
            </label>

            <div aria-live="polite" className="mt-4 min-h-6">
              {error ? (
                <p className="text-sm font-semibold text-[var(--warning-text)]" role="alert">
                  {error}
                </p>
              ) : submitting ? (
                <p className="text-sm font-semibold theme-text" role="status">
                  Eliminando identidad y cerrando la sesión…
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold theme-border theme-text"
                disabled={submitting}
                onClick={closeDialog}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="min-h-11 rounded-xl bg-[var(--warning-text)] px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canConfirm}
                onClick={confirmDeletion}
                type="button"
              >
                Confirmar eliminación
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
