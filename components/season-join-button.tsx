"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SeasonSummary } from "@/types";

type SeasonJoinButtonProps = {
  seasonId: string;
  seasonStatus: SeasonSummary["season"]["status"];
  membershipStatus?: SeasonSummary["membershipStatus"];
};

export function SeasonJoinButton({
  seasonId,
  seasonStatus,
  membershipStatus,
}: SeasonJoinButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
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

      router.refresh();
    } catch {
      setError("No se pudo unir a la temporada.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        className="rounded-md bg-circuit px-3 py-2 text-sm font-semibold text-ink disabled:cursor-wait disabled:opacity-60"
        disabled={isPending}
        onClick={joinSeason}
        type="button"
      >
        {isPending ? "Uniendo..." : "Unirse"}
      </button>
      {error ? (
        <p className="max-w-48 text-xs text-[var(--warning-text)]">{error}</p>
      ) : null}
    </div>
  );
}
