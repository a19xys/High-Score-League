"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatScore } from "@/lib/format";
import type { WeekStatus } from "@/types";

type PreviewResult = {
  weekId: string;
  playerId: string;
  username: string;
  finalScore: number;
  rank: number;
  leaguePoints: number;
  isFirstPlace: boolean;
  isSecondPlace: boolean;
  isThirdPlace: boolean;
  submittedAt: string;
};

type WeeklyResultsResponse = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  cutoffAt?: string;
  memberCount?: number;
  results?: PreviewResult[];
};

export function WeeklyResultsActions({
  weekId,
  weekStatus,
}: {
  weekId: string;
  weekStatus: WeekStatus;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<WeeklyResultsResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const canGenerate = weekStatus === "closed" || weekStatus === "published";

  function callResults(dryRun: boolean) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/weeks/${weekId}/weekly-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const payload = (await response.json()) as WeeklyResultsResponse;

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo calcular resultados.");
        return;
      }

      if (dryRun) {
        setPreview(payload);
        return;
      }

      setMessage("Resultados oficiales generados.");
      setPreview(payload);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isPending}
          onClick={() => callResults(true)}
          type="button"
        >
          Preview resultados
        </button>
        <button
          className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isPending || !canGenerate}
          onClick={() => callResults(false)}
          title={canGenerate ? undefined : "Primero cierra la semana."}
          type="button"
        >
          Generar resultados oficiales
        </button>
      </div>
      {!canGenerate ? (
        <p className="text-sm text-[var(--warning-text)]">
          Los resultados oficiales se generan automÃ¡ticamente al cierre. Esta
          acciÃ³n queda disponible para preview o regeneraciÃ³n cuando la semana
          ya estÃ© cerrada/publicada.
        </p>
      ) : null}
      {message ? <p className="text-sm theme-text-muted">{message}</p> : null}
      {preview?.results ? (
        <div className="overflow-x-auto rounded-lg border theme-border">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs font-semibold uppercase theme-table-head">
              <tr>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Jugador</th>
                <th className="px-4 py-3">Puntuación</th>
                <th className="px-4 py-3">Puntos</th>
                <th className="px-4 py-3">Podio</th>
              </tr>
            </thead>
            <tbody className="divide-y theme-border theme-surface">
              {preview.results.map((result) => (
                <tr
                  className="theme-hover"
                  key={`${result.weekId}-${result.playerId}-${result.rank}`}
                >
                  <td className="px-4 py-3 font-semibold theme-text">
                    #{result.rank}
                  </td>
                  <td className="px-4 py-3 theme-text">@{result.username}</td>
                  <td className="px-4 py-3 font-semibold theme-text">
                    {formatScore(result.finalScore)}
                  </td>
                  <td className="px-4 py-3 theme-text-muted">
                    {result.leaguePoints}
                  </td>
                  <td className="px-4 py-3 theme-text-muted">
                    {result.isFirstPlace
                      ? "1º"
                      : result.isSecondPlace
                        ? "2º"
                        : result.isThirdPlace
                          ? "3º"
                          : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-4 py-3 text-xs theme-border theme-text-muted">
            Corte: {preview.cutoffAt ?? "-"} · Miembros elegibles:{" "}
            {preview.memberCount ?? "-"}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function SubmissionValidityButton({
  submissionId,
  isValid,
}: {
  submissionId: string;
  isValid: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateValidity(nextValue: boolean) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(`/api/admin/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isValid: nextValue }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo actualizar la submission.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <button
        className="rounded-md border px-3 py-2 text-xs font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        onClick={() => updateValidity(!isValid)}
        type="button"
      >
        {isValid ? "Marcar inválida" : "Marcar válida"}
      </button>
      {message ? <p className="text-xs text-[var(--warning-text)]">{message}</p> : null}
    </div>
  );
}
