import { getSynchronizedWeekStatus } from "@/lib/week-status";

export type WeekFormPayload = {
  seasonId?: unknown;
  gameId?: unknown;
  openDate?: unknown;
  closeDate?: unknown;
  finalStretchMode?: unknown;
  customFinalStretchDate?: unknown;
  shiftFollowingWeeks?: unknown;
  rulesSummary?: unknown;
};

export type BenchmarkFormPayload = {
  label?: unknown;
  score?: unknown;
  description?: unknown;
  sortOrder?: unknown;
  isActive?: unknown;
};

export type ValidatedWeekPayload =
  | {
      ok: true;
      data: {
        season_id: string;
        game_id: string | null;
        public_start_at: string | null;
        public_freeze_at: string | null;
        final_deadline_at: string | null;
        reveal_at: string | null;
        rules_summary: string | null;
        shift_following_weeks: boolean;
      };
    }
  | { ok: false; error: string };

export type ValidatedBenchmarkPayload =
  | {
      ok: true;
      data: {
        label: string;
        score: number;
        description: string | null;
        sort_order: number;
        is_active: boolean;
      };
    }
  | { ok: false; error: string };

export const adminWeekColumns =
  "id,season_id,game_id,week_number,status,public_start_at,public_freeze_at,final_deadline_at,reveal_at,rules_summary,created_at,updated_at";

export const adminBenchmarkColumns =
  "id,week_id,label,score,description,sort_order,is_active,created_at,updated_at";

const zonedDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const finalStretchModes = new Set([
  "none",
  "last_3",
  "all",
  "custom",
]);

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false as const, error: `${label} es obligatorio.` };
  }

  return { ok: true as const, value: value.trim() };
}

function optionalText(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false as const, error: `${label} debe ser texto.` };
  }

  const trimmed = value.trim();

  return { ok: true as const, value: trimmed || null };
}

function optionalZonedDateTime(value: unknown, label: string) {
  const text = optionalText(value, label);

  if (!text.ok || text.value === null) {
    return text;
  }

  if (!zonedDateTimePattern.test(text.value)) {
    return {
      ok: false as const,
      error: `${label} debe ser ISO con zona horaria, por ejemplo 2026-05-18T00:00:00+02:00.`,
    };
  }

  if (Number.isNaN(new Date(text.value).getTime())) {
    return { ok: false as const, error: `${label} debe ser una fecha válida.` };
  }

  return { ok: true as const, value: text.value };
}

function requiredDateOnly(value: unknown, label: string) {
  if (typeof value !== "string" || !dateOnlyPattern.test(value.trim())) {
    return { ok: false as const, error: `${label} debe ser una fecha YYYY-MM-DD.` };
  }

  const trimmed = value.trim();
  const [year, month, day] = trimmed.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { ok: false as const, error: `${label} debe ser una fecha valida.` };
  }

  return { ok: true as const, value: trimmed };
}

function optionalDateOnly(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") {
    return { ok: true as const, value: null };
  }

  return requiredDateOnly(value, label);
}

function dateParts(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  return { year, month, day };
}

function dateAtUtc(dateText: string) {
  const { year, month, day } = dateParts(dateText);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateText: string, days: number) {
  const date = dateAtUtc(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function diffDays(startDate: string, endDate: string) {
  const start = dateAtUtc(startDate).getTime();
  const end = dateAtUtc(endDate).getTime();
  return Math.round((end - start) / 86_400_000);
}

function madridOffsetForDate(dateText: string) {
  const { year, month, day } = dateParts(dateText);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+1";
  const match = value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    return "+01:00";
  }

  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = match[3] ?? "00";

  return `${sign}${hours}:${minutes}`;
}

function madridTimestamp(dateText: string, timeText: string) {
  return `${dateText}T${timeText}${madridOffsetForDate(dateText)}`;
}

function resolveFinalStretchDate(
  openDate: string,
  closeDate: string,
  mode: string,
  customDate: string | null,
) {
  const durationDays = diffDays(openDate, closeDate) + 1;

  if (durationDays <= 0) {
    return {
      ok: false as const,
      error: "La fecha de apertura debe ser anterior o igual a la fecha de cierre.",
    };
  }

  if (mode === "none") {
    return { ok: true as const, value: null };
  }

  if (mode === "all") {
    return { ok: true as const, value: openDate };
  }

  if (mode === "custom") {
    if (!customDate) {
      return {
        ok: false as const,
        error: "customFinalStretchDate es obligatorio con tramo final personalizado.",
      };
    }

    if (customDate < openDate || customDate > closeDate) {
      return {
        ok: false as const,
        error: "La fecha de tramo final debe estar dentro del rango de la semana.",
      };
    }

    return { ok: true as const, value: customDate };
  }

  const days = Number(mode.replace("last_", ""));

  if (!Number.isInteger(days) || days <= 0) {
    return { ok: false as const, error: "Modo de tramo final no permitido." };
  }

  if (days > durationDays) {
    return {
      ok: false as const,
      error: "El tramo final elegido es mayor que la duración de la semana.",
    };
  }

  return { ok: true as const, value: addDays(closeDate, -(days - 1)) };
}

function validateOrderedDates(
  dates: Array<{ label: string; value: string | null }>,
) {
  for (let index = 0; index < dates.length - 1; index += 1) {
    const current = dates[index];

    if (!current.value) {
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < dates.length; nextIndex += 1) {
      const next = dates[nextIndex];

      if (
        next.value &&
        new Date(current.value).getTime() > new Date(next.value).getTime()
      ) {
        return `${current.label} debe ser anterior o igual a ${next.label}.`;
      }
    }
  }

  return null;
}

export function validateWeekPayload(payload: WeekFormPayload): ValidatedWeekPayload {
  const seasonId = requiredText(payload.seasonId, "season_id");
  if (!seasonId.ok) return { ok: false, error: seasonId.error };
  const gameId = optionalText(payload.gameId, "game_id");
  if (!gameId.ok) return { ok: false, error: gameId.error };

  const openDate = requiredDateOnly(payload.openDate, "openDate");
  if (!openDate.ok) return { ok: false, error: openDate.error };
  const closeDate = requiredDateOnly(payload.closeDate, "closeDate");
  if (!closeDate.ok) return { ok: false, error: closeDate.error };
  const customFinalStretchDate = optionalDateOnly(
    payload.customFinalStretchDate,
    "customFinalStretchDate",
  );
  if (!customFinalStretchDate.ok) {
    return { ok: false, error: customFinalStretchDate.error };
  }

  const finalStretchMode =
    typeof payload.finalStretchMode === "string"
      ? payload.finalStretchMode
      : "last_3";

  if (!finalStretchModes.has(finalStretchMode)) {
    return { ok: false, error: "Modo de tramo final no permitido." };
  }

  const finalStretchDate = resolveFinalStretchDate(
    openDate.value,
    closeDate.value,
    finalStretchMode,
    customFinalStretchDate.value,
  );

  if (!finalStretchDate.ok) {
    return { ok: false, error: finalStretchDate.error };
  }

  const rulesSummary = optionalText(payload.rulesSummary, "rules_summary");
  if (!rulesSummary.ok) return { ok: false, error: rulesSummary.error };
  const shiftFollowingWeeks =
    typeof payload.shiftFollowingWeeks === "boolean"
      ? payload.shiftFollowingWeeks
      : false;

  const publicStartAt = madridTimestamp(openDate.value, "00:00:00");
  const publicFreezeAt = finalStretchDate.value
    ? madridTimestamp(finalStretchDate.value, "00:00:00")
    : null;
  const finalDeadlineAt = madridTimestamp(closeDate.value, "23:59:59");
  const synchronizedStatus = getSynchronizedWeekStatus({
    status: "draft",
    public_start_at: publicStartAt,
    public_freeze_at: publicFreezeAt,
    final_deadline_at: finalDeadlineAt,
  });

  if (!gameId.value && synchronizedStatus !== "draft") {
    return {
      ok: false,
      error:
        "Una semana sin juego asignado solo puede guardarse si todavía no ha llegado su apertura.",
    };
  }

  const dateError = validateOrderedDates([
    { label: "public_start_at", value: publicStartAt },
    { label: "public_freeze_at", value: publicFreezeAt },
    { label: "final_deadline_at", value: finalDeadlineAt },
  ]);

  if (dateError) return { ok: false, error: dateError };

  return {
    ok: true,
    data: {
      season_id: seasonId.value,
      game_id: gameId.value,
      public_start_at: publicStartAt,
      public_freeze_at: publicFreezeAt,
      final_deadline_at: finalDeadlineAt,
      reveal_at: null,
      rules_summary: rulesSummary.value,
      shift_following_weeks: shiftFollowingWeeks,
    },
  };
}

export function validateBenchmarkPayload(
  payload: BenchmarkFormPayload,
): ValidatedBenchmarkPayload {
  const label = requiredText(payload.label, "label");
  if (!label.ok) return { ok: false, error: label.error };

  const score =
    typeof payload.score === "number"
      ? payload.score
      : typeof payload.score === "string"
        ? Number(payload.score)
        : Number.NaN;

  if (!Number.isInteger(score) || score < 0) {
    return { ok: false, error: "score debe ser un entero mayor o igual que 0." };
  }

  const sortOrder =
    payload.sortOrder === undefined || payload.sortOrder === null || payload.sortOrder === ""
      ? 0
      : typeof payload.sortOrder === "number"
        ? payload.sortOrder
        : typeof payload.sortOrder === "string"
          ? Number(payload.sortOrder)
          : Number.NaN;

  if (!Number.isInteger(sortOrder)) {
    return { ok: false, error: "sort_order debe ser un entero." };
  }

  const description = optionalText(payload.description, "description");
  if (!description.ok) return { ok: false, error: description.error };

  const isActive =
    payload.isActive === undefined || payload.isActive === null
      ? true
      : payload.isActive;

  if (typeof isActive !== "boolean") {
    return { ok: false, error: "is_active debe ser booleano." };
  }

  return {
    ok: true,
    data: {
      label: label.value,
      score,
      description: description.value,
      sort_order: sortOrder,
      is_active: isActive,
    },
  };
}
