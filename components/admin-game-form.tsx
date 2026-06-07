"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  GAME_GENRES,
  GAME_PERSPECTIVES,
  GAME_THEMES,
} from "@/lib/admin/game-taxonomy";
import type { GameRow } from "@/types/supabase";

type AdminGameFormProps = {
  mode: "create" | "edit";
  game?: GameRow;
};

type FormState = {
  title: string;
  year: string;
  developers: string[];
  publishers: string[];
  romName: string;
  perspectives: string[];
  themes: string[];
  genres: string[];
  imageUrl: string;
  headerImageUrl: string;
  logoImageUrl: string;
  instructions: string;
  manualUrl: string;
  notes: string;
};

function initialState(game?: GameRow): FormState {
  return {
    title: game?.title ?? "",
    year: game?.year ? String(game.year) : "",
    developers: game?.developers ?? [],
    publishers: game?.publishers ?? [],
    romName: game?.rom_name ?? "",
    perspectives: game?.perspectives ?? [],
    themes: game?.themes ?? [],
    genres: game?.genres ?? [],
    imageUrl: game?.image_url ?? "",
    headerImageUrl: game?.header_image_url ?? "",
    logoImageUrl: game?.logo_image_url ?? "",
    instructions: game?.instructions ?? "",
    manualUrl: game?.manual_url ?? "",
    notes: game?.notes ?? "",
  };
}

function normalizeChip(value: string) {
  return value.trim().replace(/\s+/g, " ");
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
  name: keyof Pick<
    FormState,
    "title" | "romName" | "imageUrl" | "headerImageUrl" | "logoImageUrl" | "manualUrl"
  >;
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

function ChipInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const normalized = normalizeChip(draft);

    if (!normalized) {
      setDraft("");
      return;
    }

    if (!values.some((value) => value.toLocaleLowerCase("es") === normalized.toLocaleLowerCase("es"))) {
      onChange([...values, normalized]);
    }

    setDraft("");
  }

  return (
    <div>
      <span className="text-sm font-semibold theme-text">{label}</span>
      <div className="mt-2 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border px-3 py-2 theme-input"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addDraft();
            }
          }}
          placeholder={placeholder}
          value={draft}
        />
        <button
          className="rounded-md border px-3 py-2 text-sm font-semibold theme-border theme-hover theme-text"
          onClick={addDraft}
          type="button"
        >
          Añadir
        </button>
      </div>
      {values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {values.map((value) => (
            <span
              className="inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-sm theme-border theme-surface-muted theme-text"
              key={value}
            >
              <span className="max-w-56 truncate">{value}</span>
              <button
                className="font-semibold theme-text-muted hover:text-red-500"
                onClick={() => onChange(values.filter((item) => item !== value))}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TaxonomySelector({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  function toggle(option: string) {
    if (values.includes(option)) {
      onChange(values.filter((value) => value !== option));
      return;
    }

    onChange([...values, option]);
  }

  return (
    <fieldset>
      <legend className="text-sm font-semibold theme-text">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = values.includes(option);

          return (
            <button
              aria-pressed={selected}
              className={
                selected
                  ? "rounded-full border border-circuit bg-circuit px-3 py-1.5 text-sm font-semibold text-white"
                  : "rounded-full border px-3 py-1.5 text-sm font-semibold theme-border theme-hover theme-text"
              }
              key={option}
              onClick={() => toggle(option)}
              type="button"
            >
              {option}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AdminGameForm({ mode, game }: AdminGameFormProps) {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const yearOptions = useMemo(
    () =>
      Array.from({ length: currentYear - 1971 + 1 }, (_, index) =>
        String(1971 + index),
      ),
    [currentYear],
  );
  const [state, setState] = useState<FormState>(() => initialState(game));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(name: keyof FormState, value: string) {
    setState((current) => ({ ...current, [name]: value }));
  }

  function updateList(name: keyof Pick<FormState, "developers" | "publishers" | "perspectives" | "themes" | "genres">, values: string[]) {
    setState((current) => ({ ...current, [name]: values }));
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
            developers: state.developers,
            publishers: state.publishers,
            romName: state.romName,
            perspectives: state.perspectives,
            themes: state.themes,
            genres: state.genres,
            imageUrl: state.imageUrl,
            headerImageUrl: state.headerImageUrl,
            logoImageUrl: state.logoImageUrl,
            instructions: state.instructions,
            manualUrl: state.manualUrl,
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
        <label className="block">
          <span className="text-sm font-semibold theme-text">Año</span>
          <select
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateField("year", event.target.value)}
            value={state.year}
          >
            <option value="">Sin año</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <ChipInput
          label="Desarrollador"
          onChange={(values) => updateList("developers", values)}
          placeholder="Añadir desarrollador"
          values={state.developers}
        />
        <ChipInput
          label="Editor"
          onChange={(values) => updateList("publishers", values)}
          placeholder="Añadir editor"
          values={state.publishers}
        />
        <TextInput
          label="ROM"
          name="romName"
          onChange={updateField}
          value={state.romName}
        />
        <TextInput
          label="URL de imagen"
          name="imageUrl"
          onChange={updateField}
          value={state.imageUrl}
        />
        <TextInput
          help="Imagen panorámica para la futura cabecera de semana."
          label="Header del juego"
          name="headerImageUrl"
          onChange={updateField}
          value={state.headerImageUrl}
        />
        <TextInput
          help="Logo externo opcional para superponer sobre el header."
          label="Logo del juego"
          name="logoImageUrl"
          onChange={updateField}
          value={state.logoImageUrl}
        />
        <div className="md:col-span-2">
          <TaxonomySelector
            label="Género"
            onChange={(values) => updateList("genres", values)}
            options={GAME_GENRES}
            values={state.genres}
          />
        </div>
        <div className="md:col-span-2">
          <TaxonomySelector
            label="Tema"
            onChange={(values) => updateList("themes", values)}
            options={GAME_THEMES}
            values={state.themes}
          />
        </div>
        <div className="md:col-span-2">
          <TaxonomySelector
            label="Perspectiva"
            onChange={(values) => updateList("perspectives", values)}
            options={GAME_PERSPECTIVES}
            values={state.perspectives}
          />
        </div>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">
            Instrucciones del juego
          </span>
          <textarea
            className="mt-2 min-h-36 w-full rounded-md border px-3 py-2 theme-input"
            name="instructions"
            onChange={(event) => updateField("instructions", event.target.value)}
            value={state.instructions}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            Cómo jugar, controles, ROM recomendada y normas de puntuación.
          </span>
        </label>
        <TextInput
          help="Enlace externo al manual."
          label="URL del manual"
          name="manualUrl"
          onChange={updateField}
          value={state.manualUrl}
        />
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
