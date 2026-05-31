"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdminSeasonDeleteButtonProps = {
  seasonId: string;
  seasonName: string;
};

export function AdminSeasonDeleteButton({
  seasonId,
  seasonName,
}: AdminSeasonDeleteButtonProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function deleteSeason() {
    const confirmation = window.prompt(
      `Escribe BORRAR para eliminar la temporada "${seasonName}" y sus semanas.`,
    );

    if (confirmation !== "BORRAR") {
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/seasons/${seasonId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo eliminar la temporada.");
        return;
      }

      router.push("/admin/seasons");
      router.refresh();
    });
  }

  return (
    <div>
      <button
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
        disabled={isPending}
        onClick={deleteSeason}
        type="button"
      >
        Eliminar temporada
      </button>
      {message ? <p className="mt-2 text-sm theme-text-muted">{message}</p> : null}
    </div>
  );
}
