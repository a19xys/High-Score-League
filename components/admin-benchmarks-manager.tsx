"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatScore } from "@/lib/format";
import type { WeekBenchmarkRow } from "@/types/supabase";

type AdminBenchmarksManagerProps = {
  weekId: string;
  benchmarks: WeekBenchmarkRow[];
};

type BenchmarkState = {
  label: string;
  score: string;
  description: string;
};

function emptyState(): BenchmarkState {
  return {
    label: "",
    score: "",
    description: "",
  };
}

function stateFromBenchmark(benchmark: WeekBenchmarkRow): BenchmarkState {
  return {
    label: benchmark.label,
    score: String(benchmark.score),
    description: benchmark.description ?? "",
  };
}

export function AdminBenchmarksManager({
  weekId,
  benchmarks,
}: AdminBenchmarksManagerProps) {
  const router = useRouter();
  const [newBenchmark, setNewBenchmark] = useState<BenchmarkState>(() => emptyState());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBenchmark, setEditingBenchmark] = useState<BenchmarkState>(() =>
    emptyState(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateNew(field: keyof BenchmarkState, value: string) {
    setNewBenchmark((current) => ({ ...current, [field]: value }));
  }

  function updateEditing(field: keyof BenchmarkState, value: string) {
    setEditingBenchmark((current) => ({ ...current, [field]: value }));
  }

  function beginEdit(benchmark: WeekBenchmarkRow) {
    setMessage(null);
    setEditingId(benchmark.id);
    setEditingBenchmark(stateFromBenchmark(benchmark));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingBenchmark(emptyState());
  }

  function save(url: string, method: "POST" | "PATCH", body: BenchmarkState) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo guardar el benchmark.");
        return;
      }

      setMessage(method === "POST" ? "Benchmark creado." : "Benchmark actualizado.");
      if (method === "POST") {
        setNewBenchmark(emptyState());
      } else {
        cancelEdit();
      }
      router.refresh();
    });
  }

  function deleteBenchmark(benchmark: WeekBenchmarkRow) {
    const confirmation = window.prompt(
      `Escribe BORRAR para eliminar el benchmark "${benchmark.label}".`,
    );

    if (confirmation !== "BORRAR") {
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const response = await fetch(
        `/api/admin/weeks/${weekId}/benchmarks/${benchmark.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo eliminar el benchmark.");
        return;
      }

      if (editingId === benchmark.id) {
        cancelEdit();
      }
      setMessage("Benchmark eliminado.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 theme-border theme-surface-muted">
        <p className="font-semibold theme-text">Crear benchmark</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_160px]">
          <input
            className="rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateNew("label", event.target.value)}
            placeholder="Puntuación media"
            value={newBenchmark.label}
          />
          <input
            className="rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateNew("score", event.target.value)}
            placeholder="10000"
            value={newBenchmark.score}
          />
        </div>
        <textarea
          className="mt-3 min-h-20 w-full rounded-md border px-3 py-2 theme-input"
          onChange={(event) => updateNew("description", event.target.value)}
          placeholder="Descripción opcional"
          value={newBenchmark.description}
        />
        <button
          className="mt-3 rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          onClick={() =>
            save(`/api/admin/weeks/${weekId}/benchmarks`, "POST", newBenchmark)
          }
          type="button"
        >
          Crear benchmark
        </button>
      </div>

      {benchmarks.length === 0 ? (
        <p className="text-sm theme-text-muted">No hay benchmarks todavía.</p>
      ) : (
        <div className="space-y-3">
          {benchmarks.map((benchmark) => {
            const isEditing = editingId === benchmark.id;

            return (
              <div
                className="rounded-lg border p-4 theme-border theme-surface"
                key={benchmark.id}
              >
                {isEditing ? (
                  <div>
                    <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                      <input
                        className="rounded-md border px-3 py-2 theme-input"
                        onChange={(event) =>
                          updateEditing("label", event.target.value)
                        }
                        value={editingBenchmark.label}
                      />
                      <input
                        className="rounded-md border px-3 py-2 theme-input"
                        onChange={(event) =>
                          updateEditing("score", event.target.value)
                        }
                        value={editingBenchmark.score}
                      />
                    </div>
                    <textarea
                      className="mt-3 min-h-20 w-full rounded-md border px-3 py-2 theme-input"
                      onChange={(event) =>
                        updateEditing("description", event.target.value)
                      }
                      value={editingBenchmark.description}
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending}
                        onClick={() =>
                          save(
                            `/api/admin/weeks/${weekId}/benchmarks/${benchmark.id}`,
                            "PATCH",
                            editingBenchmark,
                          )
                        }
                        type="button"
                      >
                        Guardar
                      </button>
                      <button
                        className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending}
                        onClick={cancelEdit}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-baseline gap-3">
                        <p className="font-semibold theme-text">{benchmark.label}</p>
                        <p className="text-sm font-semibold theme-text-muted">
                          {formatScore(benchmark.score)}
                        </p>
                      </div>
                      {benchmark.description ? (
                        <p className="mt-2 text-sm theme-text-muted">
                          {benchmark.description}
                        </p>
                      ) : (
                        <p className="mt-2 text-sm theme-text-muted">
                          Sin descripción.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending || editingId !== null}
                        onClick={() => beginEdit(benchmark)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                        disabled={isPending}
                        onClick={() => deleteBenchmark(benchmark)}
                        type="button"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {message ? <p className="text-sm theme-text-muted">{message}</p> : null}
    </div>
  );
}
