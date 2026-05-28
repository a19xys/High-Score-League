"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GameRow, SeasonRow, WeekRow } from "@/types/supabase";

type AdminWeekFormProps = {
  mode: "create" | "edit";
  week?: WeekRow;
  seasons: SeasonRow[];
  games: GameRow[];
  defaultSeasonId?: string;
};

type FormState = {
  seasonId: string;
  gameId: string;
  weekNumber: string;
  publicStartAt: string;
  publicFreezeAt: string;
  finalDeadlineAt: string;
  revealAt: string;
  rulesSummary: string;
};

function initialState(
  seasons: SeasonRow[],
  games: GameRow[],
  week?: WeekRow,
  defaultSeasonId?: string,
): FormState {
  return {
    seasonId: week?.season_id ?? defaultSeasonId ?? seasons[0]?.id ?? "",
    gameId: week?.game_id ?? games[0]?.id ?? "",
    weekNumber: week ? String(week.week_number) : "",
    publicStartAt: week?.public_start_at ?? "",
    publicFreezeAt: week?.public_freeze_at ?? "",
    finalDeadlineAt: week?.final_deadline_at ?? "",
    revealAt: week?.reveal_at ?? "",
    rulesSummary: week?.rules_summary ?? "",
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
  name: keyof Omit<FormState, "seasonId" | "gameId" | "rulesSummary">;
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
        onChange={(event) => onChange(name, event.target.value)}
        required={required}
        value={value}
      />
      {help ? <span className="mt-1 block text-xs theme-text-muted">{help}</span> : null}
    </label>
  );
}

export function AdminWeekForm({
  mode,
  week,
  seasons,
  games,
  defaultSeasonId,
}: AdminWeekFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() =>
    initialState(seasons, games, week, defaultSeasonId),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(name: keyof FormState, value: string) {
    setState((current) => ({ ...current, [name]: value }));
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch(
        mode === "create" ? "/api/admin/weeks" : `/api/admin/weeks/${week?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state),
        },
      );
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        week?: WeekRow;
      };

      if (!response.ok || !payload.ok || !payload.week) {
        setMessage(payload.error ?? "No se pudo guardar la semana.");
        return;
      }

      setMessage(mode === "create" ? "Semana creada." : "Semana actualizada.");
      router.refresh();

      if (mode === "create") {
        router.push(`/admin/weeks/${payload.week.id}`);
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
        <label className="block">
          <span className="text-sm font-semibold theme-text">Temporada</span>
          <select
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateField("seasonId", event.target.value)}
            required
            value={state.seasonId}
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold theme-text">Juego</span>
          <select
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateField("gameId", event.target.value)}
            required
            value={state.gameId}
          >
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title}
              </option>
            ))}
          </select>
        </label>
        <TextInput
          label="Número de semana"
          name="weekNumber"
          onChange={updateField}
          required
          value={state.weekNumber}
        />
        <TextInput
          help="ISO con zona horaria. Ejemplo: 2026-05-18T00:00:00+02:00"
          label="Apertura"
          name="publicStartAt"
          onChange={updateField}
          required
          value={state.publicStartAt}
        />
        <TextInput
          help="Opcional. Desde este momento, las nuevas puntuaciones se guardan ocultas hasta el cierre."
          label="Tramo final"
          name="publicFreezeAt"
          onChange={updateField}
          value={state.publicFreezeAt}
        />
        <TextInput
          help="ISO con zona horaria. La semana deja de aceptar submissions desde este momento."
          label="Cierre"
          name="finalDeadlineAt"
          onChange={updateField}
          required
          value={state.finalDeadlineAt}
        />
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">Reglas resumidas</span>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateField("rulesSummary", event.target.value)}
            value={state.rulesSummary}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending || seasons.length === 0 || games.length === 0}
          type="submit"
        >
          {mode === "create" ? "Crear semana" : "Guardar cambios"}
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
