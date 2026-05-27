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
  sortOrder: string;
  isActive: boolean;
};

function emptyState(): BenchmarkState {
  return {
    label: "",
    score: "",
    description: "",
    sortOrder: "0",
    isActive: true,
  };
}

function stateFromBenchmark(benchmark: WeekBenchmarkRow): BenchmarkState {
  return {
    label: benchmark.label,
    score: String(benchmark.score),
    description: benchmark.description ?? "",
    sortOrder: String(benchmark.sort_order),
    isActive: benchmark.is_active,
  };
}

export function AdminBenchmarksManager({
  weekId,
  benchmarks,
}: AdminBenchmarksManagerProps) {
  const router = useRouter();
  const [newBenchmark, setNewBenchmark] = useState<BenchmarkState>(() => emptyState());
  const [editing, setEditing] = useState<Record<string, BenchmarkState>>(() =>
    Object.fromEntries(
      benchmarks.map((benchmark) => [benchmark.id, stateFromBenchmark(benchmark)]),
    ),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
      }
      router.refresh();
    });
  }

  function updateNew(field: keyof BenchmarkState, value: string | boolean) {
    setNewBenchmark((current) => ({ ...current, [field]: value }));
  }

  function updateExisting(
    id: string,
    field: keyof BenchmarkState,
    value: string | boolean,
  ) {
    setEditing((current) => ({
      ...current,
      [id]: { ...current[id], [field]: value },
    }));
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 theme-border theme-surface-muted">
        <p className="font-semibold theme-text">Crear benchmark</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_140px_120px]">
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
          <input
            className="rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateNew("sortOrder", event.target.value)}
            placeholder="0"
            value={newBenchmark.sortOrder}
          />
          <label className="flex items-center gap-2 text-sm theme-text">
            <input
              checked={newBenchmark.isActive}
              onChange={(event) => updateNew("isActive", event.target.checked)}
              type="checkbox"
            />
            Activo
          </label>
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
            const state = editing[benchmark.id] ?? stateFromBenchmark(benchmark);

            return (
              <div
                className="rounded-lg border p-4 theme-border theme-surface-muted"
                key={benchmark.id}
              >
                <div className="grid gap-3 md:grid-cols-[1fr_140px_140px_120px]">
                  <input
                    className="rounded-md border px-3 py-2 theme-input"
                    onChange={(event) =>
                      updateExisting(benchmark.id, "label", event.target.value)
                    }
                    value={state.label}
                  />
                  <input
                    className="rounded-md border px-3 py-2 theme-input"
                    onChange={(event) =>
                      updateExisting(benchmark.id, "score", event.target.value)
                    }
                    value={state.score}
                  />
                  <input
                    className="rounded-md border px-3 py-2 theme-input"
                    onChange={(event) =>
                      updateExisting(benchmark.id, "sortOrder", event.target.value)
                    }
                    value={state.sortOrder}
                  />
                  <label className="flex items-center gap-2 text-sm theme-text">
                    <input
                      checked={state.isActive}
                      onChange={(event) =>
                        updateExisting(benchmark.id, "isActive", event.target.checked)
                      }
                      type="checkbox"
                    />
                    Activo
                  </label>
                </div>
                <textarea
                  className="mt-3 min-h-20 w-full rounded-md border px-3 py-2 theme-input"
                  onChange={(event) =>
                    updateExisting(benchmark.id, "description", event.target.value)
                  }
                  value={state.description}
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isPending}
                    onClick={() =>
                      save(
                        `/api/admin/weeks/${weekId}/benchmarks/${benchmark.id}`,
                        "PATCH",
                        state,
                      )
                    }
                    type="button"
                  >
                    Guardar benchmark
                  </button>
                  <span className="text-sm theme-text-muted">
                    Valor actual: {formatScore(benchmark.score)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {message ? <p className="text-sm theme-text-muted">{message}</p> : null}
    </div>
  );
}
