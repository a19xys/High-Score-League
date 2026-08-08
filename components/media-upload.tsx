"use client";

import { useEffect, useId, useRef, useState } from "react";
import { processImageFile } from "@/lib/media/process-image";
import { MEDIA_PRESETS, type MediaPresetKey } from "@/lib/media/presets";
import type { MediaSelection } from "@/lib/media/types";

type MediaUploadProps = {
  label: string;
  preset: MediaPresetKey;
  selection: MediaSelection;
  currentUrl?: string | null;
  onChange: (selection: MediaSelection) => void;
  disabled?: boolean;
  description?: string;
  fallbackText?: string;
};

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

export function MediaUpload({
  label,
  preset,
  selection,
  currentUrl,
  onChange,
  disabled = false,
  description,
  fallbackText,
}: MediaUploadProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const config = MEDIA_PRESETS[preset];
  const shownUrl = selection.kind === "remove" ? null : previewUrl ?? currentUrl ?? null;

  useEffect(() => {
    if (selection.kind !== "replace") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selection.media.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setProcessing(true);
    try {
      onChange({ kind: "replace", media: await processImageFile(file, preset) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo procesar la imagen.");
    } finally {
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const previewClass =
    preset === "game-header"
      ? "aspect-video w-full object-cover"
      : preset === "avatar"
        ? "h-24 w-24 rounded-full object-cover"
        : "h-28 w-28 rounded-xl object-contain";

  return (
    <div className="rounded-xl border p-3 theme-border theme-surface-muted">
      <div className={preset === "game-header" ? "space-y-3" : "flex items-center gap-4"}>
        <div className={preset === "game-header" ? "overflow-hidden rounded-lg theme-surface-strong" : "shrink-0"}>
          {shownUrl ? (
            <img alt={`Vista previa: ${label}`} className={previewClass} src={shownUrl} />
          ) : (
            <div className={`${previewClass} flex items-center justify-center border border-dashed text-xs theme-border theme-text-muted`}>
              {fallbackText || "Sin imagen"}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold theme-text">{label}</p>
          <p className="mt-1 text-xs leading-5 theme-text-muted">
            {description ?? `JPEG, PNG o WebP · máximo 12 MB · salida ${config.maxWidth}×${config.maxHeight}`}
          </p>
          {selection.kind === "replace" ? (
            <p className="mt-1 text-xs font-semibold text-emerald-600" role="status">
              Lista: {selection.media.width}×{selection.media.height} · {formatBytes(selection.media.outputBytes)}
            </p>
          ) : selection.kind === "remove" ? (
            <p className="mt-1 text-xs font-semibold text-amber-600" role="status">Se quitará al guardar.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled || processing}
              id={inputId}
              onChange={(event) => void selectFile(event.target.files?.[0])}
              ref={inputRef}
              type="file"
            />
            <label className="cursor-pointer rounded-md bg-circuit px-3 py-2 text-xs font-semibold text-slate-950 aria-disabled:cursor-not-allowed aria-disabled:opacity-60" htmlFor={inputId} aria-disabled={disabled || processing}>
              {processing ? "Procesando…" : shownUrl ? "Cambiar imagen" : "Subir imagen"}
            </label>
            {shownUrl || selection.kind === "replace" ? (
              <button className="rounded-md border px-3 py-2 text-xs font-semibold theme-border theme-hover theme-text" disabled={disabled || processing} onClick={() => onChange({ kind: "remove" })} type="button">
                Quitar
              </button>
            ) : null}
            {selection.kind !== "unchanged" ? (
              <button className="rounded-md border px-3 py-2 text-xs font-semibold theme-border theme-hover theme-text" disabled={disabled || processing} onClick={() => onChange({ kind: "unchanged" })} type="button">
                Cancelar cambio
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}
    </div>
  );
}
