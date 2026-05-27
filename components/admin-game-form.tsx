"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GameRow } from "@/types/supabase";

type AdminGameFormProps = {
  mode: "create" | "edit";
  game?: GameRow;
};

type FormState = {
  title: string;
  year: string;
  developer: string;
  publisher: string;
  romName: string;
  genre: string;
  controlType: string;
  difficulty: string;
  imageUrl: string;
  notes: string;
};

function initialState(game?: GameRow): FormState {
  return {
    title: game?.title ?? "",
    year: game?.year ? String(game.year) : "",
    developer: game?.developer ?? "",
    publisher: game?.publisher ?? "",
    romName: game?.rom_name ?? "",
    genre: game?.genre ?? "",
    controlType: game?.control_type ?? "",
    difficulty: game?.difficulty ?? "",
    imageUrl: game?.image_url ?? "",
    notes: game?.notes ?? "",
  };
}

function TextInput({
  label,
  name,
  value,
  onChange,
  required,
  help,
}: {
  label: string;
  name: keyof FormState;
  value: string;
  onChange: (name: keyof FormState, value: string) => void;
  required?: boolean;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold theme-text">{label}</span>
      <input
        className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
        name={name}
        onChange={(event) => onChange(name, event.target.value)}
        required={required}
        value={value}
      />
      {help ? <span className="mt-1 block text-xs theme-text-muted">{help}</span> : null}
    </label>
  );
}

export function AdminGameForm({ mode, game }: AdminGameFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => initialState(game));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(name: keyof FormState, value: string) {
    setState((current) => ({ ...current, [name]: value }));
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(
        mode === "create" ? "/api/admin/games" : `/api/admin/games/${game?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: state.title,
            year: state.year,
            developer: state.developer,
            publisher: state.publisher,
            romName: state.romName,
            genre: state.genre,
            controlType: state.controlType,
            difficulty: state.difficulty,
            imageUrl: state.imageUrl,
            notes: state.notes,
          }),
        },
      );
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        game?: GameRow;
      };

      if (!response.ok || !payload.ok || !payload.game) {
        setMessage(payload.error ?? "No se pudo guardar el juego.");
        return;
      }

      setMessage(mode === "create" ? "Juego creado." : "Juego actualizado.");
      router.refresh();

      if (mode === "create") {
        router.push(`/admin/games/${payload.game.id}`);
      }
    });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput
          label="Título"
          name="title"
          onChange={updateField}
          required
          value={state.title}
        />
        <TextInput
          help="Opcional. Entre 1970 y 2100."
          label="Año"
          name="year"
          onChange={updateField}
          value={state.year}
        />
        <TextInput
          label="Developer"
          name="developer"
          onChange={updateField}
          value={state.developer}
        />
        <TextInput
          label="Publisher"
          name="publisher"
          onChange={updateField}
          value={state.publisher}
        />
        <TextInput
          label="ROM name"
          name="romName"
          onChange={updateField}
          value={state.romName}
        />
        <TextInput
          label="Género"
          name="genre"
          onChange={updateField}
          value={state.genre}
        />
        <TextInput
          help="Ejemplos: estándar, doble stick, trackball, spinner."
          label="Tipo de control"
          name="controlType"
          onChange={updateField}
          value={state.controlType}
        />
        <TextInput
          label="Dificultad aproximada"
          name="difficulty"
          onChange={updateField}
          value={state.difficulty}
        />
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">Image URL</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            name="imageUrl"
            onChange={(event) => updateField("imageUrl", event.target.value)}
            placeholder="https://..."
            value={state.imageUrl}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            Solo texto por ahora. No hay subida real de imágenes.
          </span>
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">Notas</span>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border px-3 py-2 theme-input"
            name="notes"
            onChange={(event) => updateField("notes", event.target.value)}
            value={state.notes}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {mode === "create" ? "Crear juego" : "Guardar cambios"}
        </button>
        {message ? (
          <p className="text-sm theme-text-muted" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
