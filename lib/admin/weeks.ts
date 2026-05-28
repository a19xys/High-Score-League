import type { WeekStatus } from "@/types";

export type WeekFormPayload = {
  seasonId?: unknown;
  gameId?: unknown;
  weekNumber?: unknown;
  status?: unknown;
  publicStartAt?: unknown;
  publicFreezeAt?: unknown;
  finalDeadlineAt?: unknown;
  revealAt?: unknown;
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
        game_id: string;
        week_number: number;
        status: WeekStatus;
        public_start_at: string | null;
        public_freeze_at: string | null;
        final_deadline_at: string | null;
        reveal_at: string | null;
        rules_summary: string | null;
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

const allowedStatuses = new Set<WeekStatus>([
  "draft",
  "active",
  "frozen",
  "closed",
  "published",
]);
const zonedDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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
  const gameId = requiredText(payload.gameId, "game_id");
  if (!gameId.ok) return { ok: false, error: gameId.error };

  const weekNumber =
    typeof payload.weekNumber === "number"
      ? payload.weekNumber
      : typeof payload.weekNumber === "string"
        ? Number(payload.weekNumber)
        : Number.NaN;

  if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
    return { ok: false, error: "week_number debe ser un entero mayor que 0." };
  }

  if (typeof payload.status !== "string" || !allowedStatuses.has(payload.status as WeekStatus)) {
    return { ok: false, error: "status no permitido." };
  }

  const publicStartAt = optionalZonedDateTime(payload.publicStartAt, "public_start_at");
  if (!publicStartAt.ok) return { ok: false, error: publicStartAt.error };
  const publicFreezeAt = optionalZonedDateTime(payload.publicFreezeAt, "public_freeze_at");
  if (!publicFreezeAt.ok) return { ok: false, error: publicFreezeAt.error };
  const finalDeadlineAt = optionalZonedDateTime(payload.finalDeadlineAt, "final_deadline_at");
  if (!finalDeadlineAt.ok) return { ok: false, error: finalDeadlineAt.error };
  const revealAt = optionalZonedDateTime(payload.revealAt, "reveal_at");
  if (!revealAt.ok) return { ok: false, error: revealAt.error };
  const rulesSummary = optionalText(payload.rulesSummary, "rules_summary");
  if (!rulesSummary.ok) return { ok: false, error: rulesSummary.error };

  const dateError = validateOrderedDates([
    { label: "public_start_at", value: publicStartAt.value },
    { label: "public_freeze_at", value: publicFreezeAt.value },
    { label: "final_deadline_at", value: finalDeadlineAt.value },
  ]);

  if (dateError) {
    return { ok: false, error: dateError };
  }

  return {
    ok: true,
    data: {
      season_id: seasonId.value,
      game_id: gameId.value,
      week_number: weekNumber,
      status: payload.status as WeekStatus,
      public_start_at: publicStartAt.value,
      public_freeze_at: publicFreezeAt.value,
      final_deadline_at: finalDeadlineAt.value,
      reveal_at: revealAt.value,
      rules_summary: rulesSummary.value,
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

  if (typeof payload.isActive !== "boolean") {
    return { ok: false, error: "is_active debe ser booleano." };
  }

  return {
    ok: true,
    data: {
      label: label.value,
      score,
      description: description.value,
      sort_order: sortOrder,
      is_active: payload.isActive,
    },
  };
}
