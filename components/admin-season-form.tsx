"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SeasonRow } from "@/types/supabase";
import type { SeasonStatus } from "@/types";

type AdminSeasonFormProps = {
  mode: "create" | "edit";
  season?: SeasonRow;
};

type FormState = {
  name: string;
  slug: string;
  version: string;
  status: SeasonStatus;
  startsAt: string;
  endsAt: string;
};

function initialState(season?: SeasonRow): FormState {
  return {
    name: season?.name ?? "",
    slug: season?.slug ?? "",
    version: season?.version ?? "",
    status: season?.status ?? "draft",
    startsAt: season?.starts_at ?? "",
    endsAt: season?.ends_at ?? "",
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
  name: keyof Omit<FormState, "status">;
  value: string;
  onChange: (name: keyof Omit<FormState, "status">, value: string) => void;
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

export function AdminSeasonForm({ mode, season }: AdminSeasonFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => initialState(season));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(name: keyof Omit<FormState, "status">, value: string) {
    setState((current) => ({ ...current, [name]: value }));
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/seasons"
          : `/api/admin/seasons/${season?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        },
      );
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        season?: SeasonRow;
      };

      if (!response.ok || !payload.ok || !payload.season) {
        setMessage(payload.error ?? "No se pudo guardar la temporada.");
        return;
      }

      setMessage(mode === "create" ? "Temporada creada." : "Temporada actualizada.");
      router.refresh();

      if (mode === "create") {
        router.push(`/admin/seasons/${payload.season.id}`);
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
          label="Nombre"
          name="name"
          onChange={updateField}
          required
          value={state.name}
        />
        <TextInput
          help="Minúsculas, números y guiones. Ejemplo: temporada-i"
          label="Slug"
          name="slug"
          onChange={updateField}
          required
          value={state.slug}
        />
        <TextInput
          help="Opcional. Ejemplo: I, 2026, beta."
          label="Versión"
          name="version"
          onChange={updateField}
          value={state.version}
        />
        <label className="block">
          <span className="text-sm font-semibold theme-text">Estado</span>
          <select
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) =>
              setState((current) => ({
                ...current,
                status: event.target.value as SeasonStatus,
              }))
            }
            value={state.status}
          >
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="completed">completed</option>
          </select>
        </label>
        <TextInput
          help="ISO con zona horaria. Ejemplo: 2026-05-18T00:00:00+02:00"
          label="Inicio"
          name="startsAt"
          onChange={updateField}
          value={state.startsAt}
        />
        <TextInput
          help="ISO con zona horaria. Ejemplo: 2026-07-12T23:59:00+02:00"
          label="Fin"
          name="endsAt"
          onChange={updateField}
          value={state.endsAt}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {mode === "create" ? "Crear temporada" : "Guardar cambios"}
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
