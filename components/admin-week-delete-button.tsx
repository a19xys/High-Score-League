"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdminWeekDeleteButtonProps = {
  weekId: string;
};

export function AdminWeekDeleteButton({ weekId }: AdminWeekDeleteButtonProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function deleteWeek() {
    const confirmation = window.prompt(
      "Escribe BORRAR para eliminar esta semana. También se eliminarán sus benchmarks.",
    );

    if (confirmation !== "BORRAR") {
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/weeks/${weekId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo eliminar la semana.");
        return;
      }

      router.push("/admin/weeks");
      router.refresh();
    });
  }

  return (
    <div>
      <button
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
        disabled={isPending}
        onClick={deleteWeek}
        type="button"
      >
        Eliminar semana
      </button>
      {message ? <p className="mt-2 text-sm theme-text-muted">{message}</p> : null}
    </div>
  );
}
