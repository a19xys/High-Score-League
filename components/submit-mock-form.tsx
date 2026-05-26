"use client";

import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";

export function SubmitMockForm() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  return (
    <form className="space-y-5">
      <label className="block">
        <span className="text-sm font-semibold theme-text">Puntuación</span>
        <input
          className="mt-2 w-full rounded-md border px-3 py-2 outline-none ring-circuit/20 focus:border-circuit focus:ring-4 theme-input"
          min="0"
          placeholder="184320"
          type="number"
        />
      </label>

      <label className="block">
        <span className="text-sm font-semibold theme-text">Captura opcional</span>
        <input
          accept="image/*"
          className="mt-2 w-full rounded-md border border-dashed px-3 py-3 text-sm theme-input"
          onChange={handleFileChange}
          type="file"
        />
      </label>

      <div className="rounded-lg border border-dashed p-4 theme-border theme-surface-muted">
        <p className="text-sm font-semibold theme-text">Vista previa</p>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Vista previa de captura seleccionada"
            className="mt-3 max-h-72 w-full rounded-md object-contain"
            src={previewUrl}
          />
        ) : (
          <p className="mt-2 text-sm theme-text-muted">
            Puedes seleccionar una imagen para ver una vista previa local. El
            flujo futuro podrá registrar eventos automáticos sin captura.
          </p>
        )}
      </div>

      <label className="block">
        <span className="text-sm font-semibold theme-text">Comentario opcional</span>
        <textarea
          className="mt-2 min-h-28 w-full rounded-md border px-3 py-2 outline-none ring-circuit/20 focus:border-circuit focus:ring-4 theme-input"
          placeholder="Detalles de la partida, plataforma o contexto."
        />
      </label>

      <button
        className="w-full cursor-not-allowed rounded-md bg-slate-300 px-4 py-3 text-sm font-semibold text-slate-600"
        disabled
        type="button"
      >
        Envío mock desactivado
      </button>
    </form>
  );
}
