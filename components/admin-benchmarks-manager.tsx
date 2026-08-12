"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MediaUpload } from "@/components/media-upload";
import { formatScore } from "@/lib/format";
import { executeMediaSave } from "@/lib/media/lifecycle";
import { getPublicMediaUrl } from "@/lib/media/resolver";
import {
  UNCHANGED_MEDIA_SELECTION,
  type MediaSelection,
} from "@/lib/media/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { WeekBenchmarkRow } from "@/types/supabase";

type AdminBenchmarksManagerProps = {
  weekId: string;
  benchmarks: WeekBenchmarkRow[];
};

type BenchmarkState = {
  label: string;
  score: string;
  description: string;
  imageSelection: MediaSelection;
  imageStoragePath: string | null;
  imageUrl: string | null;
};

type BenchmarkResponse = {
  ok: boolean;
  error?: string;
  cleanupWarning?: string | null;
};

function emptyState(): BenchmarkState {
  return {
    label: "",
    score: "",
    description: "",
    imageSelection: UNCHANGED_MEDIA_SELECTION,
    imageStoragePath: null,
    imageUrl: null,
  };
}

function stateFromBenchmark(benchmark: WeekBenchmarkRow): BenchmarkState {
  return {
    label: benchmark.label,
    score: String(benchmark.score),
    description: benchmark.description ?? "",
    imageSelection: UNCHANGED_MEDIA_SELECTION,
    imageStoragePath: benchmark.image_storage_path,
    imageUrl: getPublicMediaUrl(benchmark.image_storage_path),
  };
}

function BenchmarkEditorFields({
  disabled,
  onChange,
  state,
}: {
  disabled: boolean;
  onChange: (next: BenchmarkState) => void;
  state: BenchmarkState;
}) {
  return (
    <div className="space-y-4">
      <MediaUpload
        currentUrl={state.imageUrl}
        description="JPEG, PNG o WebP · máximo 12 MB · se convierte a WebP con transparencia"
        disabled={disabled}
        fallbackText="REF"
        label="Imagen"
        onChange={(imageSelection) => onChange({ ...state, imageSelection })}
        preset="benchmark-icon"
        selection={state.imageSelection}
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="block min-w-0">
          <span className="text-sm font-bold theme-text">Nombre</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => onChange({ ...state, label: event.target.value })}
            placeholder="Puntuación media"
            value={state.label}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-sm font-bold theme-text">Puntuación</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 tabular-nums theme-input"
            inputMode="numeric"
            onChange={(event) => onChange({ ...state, score: event.target.value })}
            placeholder="10000"
            value={state.score}
          />
        </label>
      </div>
      <label className="block">
        <span className="text-sm font-bold theme-text">Descripción</span>
        <textarea
          className="mt-2 min-h-20 w-full rounded-md border px-3 py-2 theme-input"
          onChange={(event) =>
            onChange({ ...state, description: event.target.value })
          }
          placeholder="Descripción opcional"
          value={state.description}
        />
      </label>
    </div>
  );
}

function BenchmarkListImage({ benchmark }: { benchmark: WeekBenchmarkRow }) {
  const imageUrl = getPublicMediaUrl(benchmark.image_storage_path);

  return imageUrl ? (
    <img alt="" className="h-14 w-14 shrink-0 object-contain" src={imageUrl} />
  ) : (
    <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border text-[10px] font-black tracking-wide theme-border theme-surface-muted theme-text-muted">
      REF
    </span>
  );
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

  function beginEdit(benchmark: WeekBenchmarkRow) {
    setMessage(null);
    setEditingId(benchmark.id);
    setEditingBenchmark(stateFromBenchmark(benchmark));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingBenchmark(emptyState());
  }

  function save(
    url: string,
    method: "POST" | "PATCH",
    state: BenchmarkState,
  ) {
    setMessage(null);
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();

      if (!supabase) {
        setMessage("El almacenamiento de imágenes no está disponible en este entorno.");
        return;
      }

      try {
        const saved = await executeMediaSave({
          supabase,
          changes: [
            {
              key: "benchmark-image",
              selection: state.imageSelection,
              currentStoragePath: state.imageStoragePath,
              currentUrl: state.imageUrl,
            },
          ],
          persist: async ([image]) => {
            const response = await fetch(url, {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                label: state.label,
                score: state.score,
                description: state.description,
                imageStoragePath: image.storagePath,
              }),
            });
            const payload = (await response.json()) as BenchmarkResponse;

            if (!response.ok || !payload.ok) {
              throw new Error(payload.error ?? "No se pudo guardar el benchmark.");
            }

            return payload;
          },
        });

        setMessage(
          saved.cleanupWarning
            ? `Benchmark guardado. No se pudo retirar la imagen anterior: ${saved.cleanupWarning}`
            : method === "POST"
              ? "Benchmark creado."
              : "Benchmark actualizado.",
        );
        if (method === "POST") {
          setNewBenchmark(emptyState());
        } else {
          cancelEdit();
        }
        router.refresh();
      } catch (caught) {
        setMessage(
          caught instanceof Error ? caught.message : "No se pudo guardar el benchmark.",
        );
      }
    });
  }

  function deleteBenchmark(benchmark: WeekBenchmarkRow) {
    const confirmation = window.prompt(
      `Escribe BORRAR para eliminar el benchmark "${benchmark.label}".`,
    );

    if (confirmation !== "BORRAR") return;

    setMessage(null);
    startTransition(async () => {
      const response = await fetch(
        `/api/admin/weeks/${weekId}/benchmarks/${benchmark.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as BenchmarkResponse;

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "No se pudo eliminar el benchmark.");
        return;
      }

      if (editingId === benchmark.id) cancelEdit();
      setMessage(
        payload.cleanupWarning
          ? `Benchmark eliminado. No se pudo retirar su imagen: ${payload.cleanupWarning}`
          : "Benchmark eliminado.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 theme-border theme-surface-muted">
        <p className="font-semibold theme-text">Crear benchmark</p>
        <div className="mt-4">
          <BenchmarkEditorFields
            disabled={isPending}
            onChange={setNewBenchmark}
            state={newBenchmark}
          />
        </div>
        <button
          className="mt-4 min-h-11 rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
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
              <div className="rounded-lg border p-4 theme-border theme-surface" key={benchmark.id}>
                {isEditing ? (
                  <div>
                    <BenchmarkEditorFields
                      disabled={isPending}
                      onChange={setEditingBenchmark}
                      state={editingBenchmark}
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        className="min-h-11 rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
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
                        className="min-h-11 rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending}
                        onClick={cancelEdit}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <BenchmarkListImage benchmark={benchmark} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <p className="font-semibold theme-text">{benchmark.label}</p>
                          <p className="whitespace-nowrap text-sm font-semibold tabular-nums theme-text-muted">
                            {formatScore(benchmark.score)}
                          </p>
                        </div>
                        <p className="mt-1 text-sm leading-5 theme-text-muted">
                          {benchmark.description || "Sin descripción."}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        className="min-h-11 rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isPending || editingId !== null}
                        onClick={() => beginEdit(benchmark)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="min-h-11 rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
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
