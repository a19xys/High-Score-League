"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdminGameDeleteButtonProps = {
  gameId: string;
  gameTitle: string;
  disabled: boolean;
};

export function AdminGameDeleteButton({
  gameId,
  gameTitle,
  disabled,
}: AdminGameDeleteButtonProps) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const canDelete = !disabled && confirmation === "BORRAR";

  function deleteGame() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/games/${gameId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo borrar el juego.");
        return;
      }

      router.refresh();
      router.push("/admin/games");
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm theme-text-muted">
        Para borrar {gameTitle}, escribe <strong>BORRAR</strong>. No se borran
        semanas, submissions ni resultados.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          className="w-full rounded-md border px-3 py-2 theme-input sm:max-w-xs"
          disabled={disabled || isPending}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="BORRAR"
          value={confirmation}
        />
        <button
          className="rounded-md border border-[var(--warning-border)] px-4 py-3 text-sm font-semibold text-[var(--warning-text)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canDelete || isPending}
          onClick={deleteGame}
          type="button"
        >
          Eliminar juego
        </button>
      </div>
      {disabled ? (
        <p className="text-sm theme-text-muted">
          No se puede borrar mientras exista al menos una semana asociada.
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-[var(--warning-text)]" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
