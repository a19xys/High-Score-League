"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SeasonSummary } from "@/types";

type SeasonJoinButtonProps = {
  seasonId: string;
  seasonStatus: SeasonSummary["season"]["status"];
  membershipStatus?: SeasonSummary["membershipStatus"];
  label?: string;
  pendingLabel?: string;
  refreshOnSuccess?: boolean;
  successLabel?: string;
};

export function SeasonJoinButton({
  seasonId,
  seasonStatus,
  membershipStatus,
  label = "Unirse",
  pendingLabel = "Uniendo...",
  refreshOnSuccess = true,
  successLabel = "Unido",
}: SeasonJoinButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [hasSucceeded, setHasSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (seasonStatus !== "active") {
    return <span className="text-sm font-semibold theme-text-muted">Cerrada</span>;
  }

  if (membershipStatus === "joined") {
    return (
      <span className="rounded-full border px-3 py-1 text-xs font-semibold uppercase theme-border theme-surface-muted theme-text">
        Unido
      </span>
    );
  }

  if (membershipStatus === "login_required") {
    return (
      <Link className="font-semibold text-circuit hover:underline" href="/login">
        Iniciar sesión
      </Link>
    );
  }

  async function joinSeason() {
    setIsPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/seasons/${seasonId}/join`, {
        method: "POST",
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(result.error ?? "No se pudo unir a la temporada.");
        return;
      }

      setHasSucceeded(true);

      if (refreshOnSuccess) {
        router.refresh();
      }
    } catch {
      setError("No se pudo unir a la temporada.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        className={`rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-80 ${
          hasSucceeded
            ? "cursor-default border theme-border theme-surface-muted theme-text"
            : "bg-circuit text-ink disabled:cursor-wait"
        }`}
        disabled={isPending || hasSucceeded}
        onClick={joinSeason}
        type="button"
      >
        {hasSucceeded ? successLabel : isPending ? pendingLabel : label}
      </button>
      {error ? (
        <p className="max-w-48 text-xs text-[var(--warning-text)]">{error}</p>
      ) : null}
    </div>
  );
}
