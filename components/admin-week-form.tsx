"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GameRow, SeasonRow, WeekRow } from "@/types/supabase";

type AdminWeekFormProps = {
  mode: "create" | "edit";
  week?: WeekRow;
  seasons: SeasonRow[];
  games: GameRow[];
  weeks: WeekRow[];
  defaultSeasonId?: string;
};

type FinalStretchMode =
  | "none"
  | "last_3"
  | "all"
  | "custom";

type FormState = {
  seasonId: string;
  gameId: string;
  openDate: string;
  closeDate: string;
  finalStretchMode: FinalStretchMode;
  customFinalStretchDate: string;
  shiftFollowingWeeks: boolean;
  rulesSummary: string;
};

function dateOnlyInMadrid(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;

  return year && month && day ? `${year}-${month}-${day}` : "";
}

function dateAtUtc(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateText: string, days: number) {
  const date = dateAtUtc(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDays(startDate: string, endDate: string) {
  return Math.round((dateAtUtc(endDate).getTime() - dateAtUtc(startDate).getTime()) / 86_400_000);
}

function nextMondayFrom(dateText: string) {
  const date = dateAtUtc(dateText);
  const day = date.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().slice(0, 10);
}

function todayDate() {
  return dateOnlyInMadrid(new Date().toISOString());
}

function activeSeasonId(seasons: SeasonRow[]) {
  const now = Date.now();
  const active = seasons.find((season) => {
    const startsAt = season.starts_at ? new Date(season.starts_at).getTime() : null;
    const endsAt = season.ends_at ? new Date(season.ends_at).getTime() : null;

    return (
      season.status === "active" ||
      (startsAt !== null && startsAt <= now && (endsAt === null || now < endsAt))
    );
  });

  return active?.id ?? "";
}

function defaultsForSeason(seasonId: string, seasons: SeasonRow[], weeks: WeekRow[]) {
  const seasonWeeks = weeks
    .filter((week) => week.season_id === seasonId)
    .sort((a, b) => {
      const aDate = a.final_deadline_at ?? a.public_start_at ?? "";
      const bDate = b.final_deadline_at ?? b.public_start_at ?? "";
      return aDate.localeCompare(bDate) || a.week_number - b.week_number;
    });
  const lastWeek = seasonWeeks.at(-1);
  let openDate = "";

  if (lastWeek?.final_deadline_at) {
    openDate = nextMondayFrom(dateOnlyInMadrid(lastWeek.final_deadline_at));
  } else {
    const season = seasons.find((row) => row.id === seasonId);
    openDate = dateOnlyInMadrid(season?.starts_at) || nextMondayFrom(todayDate());
  }

  return {
    openDate,
    closeDate: openDate ? addDays(openDate, 6) : "",
    finalStretchMode: "last_3" as FinalStretchMode,
    customFinalStretchDate: "",
  };
}

function inferFinalStretchMode(week: WeekRow): {
  mode: FinalStretchMode;
  customDate: string;
} {
  const openDate = dateOnlyInMadrid(week.public_start_at);
  const closeDate = dateOnlyInMadrid(week.final_deadline_at);
  const freezeDate = dateOnlyInMadrid(week.public_freeze_at);

  if (!freezeDate) {
    return { mode: "none", customDate: "" };
  }

  if (freezeDate === openDate) {
    return { mode: "all", customDate: "" };
  }

  const days = diffDays(freezeDate, closeDate) + 1;

  if (days === 3) {
    return { mode: "last_3", customDate: "" };
  }

  return { mode: "custom", customDate: freezeDate };
}

function initialState(
  seasons: SeasonRow[],
  games: GameRow[],
  weeks: WeekRow[],
  week?: WeekRow,
  defaultSeasonId?: string,
): FormState {
  if (week) {
    const finalStretch = inferFinalStretchMode(week);

    return {
      seasonId: week.season_id,
      gameId: week.game_id ?? "",
      openDate: dateOnlyInMadrid(week.public_start_at),
      closeDate: dateOnlyInMadrid(week.final_deadline_at),
      finalStretchMode: finalStretch.mode,
      customFinalStretchDate: finalStretch.customDate,
      shiftFollowingWeeks: false,
      rulesSummary: week.rules_summary ?? "",
    };
  }

  const seasonId =
    defaultSeasonId && seasons.some((season) => season.id === defaultSeasonId)
      ? defaultSeasonId
      : activeSeasonId(seasons);
  const defaults = defaultsForSeason(seasonId, seasons, weeks);

  return {
    seasonId,
    gameId: games.length > 0 ? "" : "",
    openDate: defaults.openDate,
    closeDate: defaults.closeDate,
    finalStretchMode: defaults.finalStretchMode,
    customFinalStretchDate: defaults.customFinalStretchDate,
    shiftFollowingWeeks: false,
    rulesSummary: "",
  };
}

function DateInput({
  label,
  name,
  value,
  onChange,
  required,
  help,
}: {
  label: string;
  name: "openDate" | "closeDate" | "customFinalStretchDate";
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
        type="date"
        value={value}
      />
      {help ? <span className="mt-1 block text-xs theme-text-muted">{help}</span> : null}
    </label>
  );
}

function finalStretchOptions(openDate: string, closeDate: string) {
  const duration = openDate && closeDate ? diffDays(openDate, closeDate) + 1 : 0;

  return [
    { value: "all", label: "Todo el plazo", enabled: duration >= 1 },
    { value: "last_3", label: "Últimos 3 días", enabled: duration >= 3 },
    { value: "none", label: "Sin tramo final", enabled: true },
    { value: "custom", label: "Personalizado", enabled: duration >= 1 },
  ] as Array<{ value: FinalStretchMode; label: string; enabled: boolean }>;
}

export function AdminWeekForm({
  mode,
  week,
  seasons,
  games,
  weeks,
  defaultSeasonId,
}: AdminWeekFormProps) {
  const router = useRouter();
  const [state, setState] = useState<FormState>(() =>
    initialState(seasons, games, weeks, week, defaultSeasonId),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(name: keyof FormState, value: string) {
    setState((current) => {
      if (name === "seasonId" && mode === "create") {
        const defaults = defaultsForSeason(value, seasons, weeks);

        return { ...current, seasonId: value, ...defaults };
      }

      return { ...current, [name]: value };
    });
  }

  function updateCheckbox(name: "shiftFollowingWeeks", value: boolean) {
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
        reconciliation?: {
          reopened?: boolean;
          weeklyResultsDeleted?: number;
          submissionsMadeVisible?: number;
          submissionsMadeHidden?: number;
        };
        shiftedWeeks?: Array<{ id: string; weekNumber: number }>;
      };

      if (!response.ok || !payload.ok || !payload.week) {
        setMessage(payload.error ?? "No se pudo guardar la semana.");
        return;
      }

      const details: string[] = [];

      if (payload.reconciliation?.reopened) {
        details.push("Esta semana se ha reabierto. Los resultados oficiales anteriores se han retirado.");
      }

      if (
        payload.reconciliation &&
        ((payload.reconciliation.submissionsMadeVisible ?? 0) > 0 ||
          (payload.reconciliation.submissionsMadeHidden ?? 0) > 0)
      ) {
        details.push("La visibilidad de submissions se ha reconciliado con las nuevas fechas.");
      }

      if (payload.shiftedWeeks && payload.shiftedWeeks.length > 0) {
        details.push(`Se han retrasado ${payload.shiftedWeeks.length} semanas posteriores.`);
      }

      setMessage(
        [
          mode === "create" ? "Semana creada." : "Semana actualizada.",
          ...details,
        ].join(" "),
      );
      router.refresh();

      if (mode === "create") {
        router.push(`/admin/weeks/${payload.week.id}`);
      }
    });
  }

  const availableFinalStretchOptions = finalStretchOptions(
    state.openDate,
    state.closeDate,
  );

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
            <option value="">Selecciona una</option>
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
            value={state.gameId}
          >
            <option value="">Sin juego asignado</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.title}
              </option>
            ))}
          </select>
        </label>
        <DateInput
          help="Se guardará como 00:00:00 Europe/Madrid."
          label="Fecha de apertura"
          name="openDate"
          onChange={updateField}
          required
          value={state.openDate}
        />
        <DateInput
          help="Se guardará como 23:59:59 Europe/Madrid."
          label="Fecha de cierre"
          name="closeDate"
          onChange={updateField}
          required
          value={state.closeDate}
        />
        <label className="block">
          <span className="text-sm font-semibold theme-text">Tramo final</span>
          <select
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) =>
              updateField("finalStretchMode", event.target.value)
            }
            value={state.finalStretchMode}
          >
            {availableFinalStretchOptions.map((option) => (
              <option
                disabled={!option.enabled}
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs theme-text-muted">
            Las submissions desde el tramo final se guardan ocultas hasta el cierre.
          </span>
        </label>
        {state.finalStretchMode === "custom" ? (
          <DateInput
            help="Debe estar dentro del rango de la semana."
            label="Fecha de tramo final"
            name="customFinalStretchDate"
            onChange={updateField}
            required
            value={state.customFinalStretchDate}
          />
        ) : null}
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold theme-text">
            Instrucciones específicas de esta semana
          </span>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => updateField("rulesSummary", event.target.value)}
            value={state.rulesSummary}
          />
          <span className="mt-1 block text-xs theme-text-muted">
            Déjalo vacío para usar las instrucciones del juego asociado.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm theme-border theme-surface-muted md:col-span-2">
          <input
            checked={state.shiftFollowingWeeks}
            className="mt-1"
            onChange={(event) =>
              updateCheckbox("shiftFollowingWeeks", event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <span className="block font-semibold theme-text">
              Retrasar semanas posteriores si hay solape
            </span>
            <span className="mt-1 block theme-text-muted">
              Mantiene duración y tramo final relativo. No desplaza semanas con resultados oficiales.
            </span>
          </span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending || seasons.length === 0}
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
