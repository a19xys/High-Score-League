import type {
  HomePollOptionRow,
  HomePollRow,
} from "@/types/supabase";

export type AdminHomePollOptionInput = {
  id?: string | null;
  label: string;
};

export type AdminHomePollInput = {
  question: string;
  closesAt: string | null;
  enabled: boolean;
  options: AdminHomePollOptionInput[];
};

export type ValidatedHomePollInput = {
  question: string;
  closes_at: string | null;
  enabled: boolean;
  options: Array<{
    id?: string;
    label: string;
    sort_order: number;
  }>;
};

export const homePollColumns =
  "id,singleton_key,question,enabled,closes_at,created_at,updated_at";

export const homePollOptionColumns =
  "id,poll_id,label,sort_order,created_at";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return { error: "La fecha de cierre no es válida." } as const;
  }

  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    return { error: "La fecha de cierre no es válida." } as const;
  }

  return new Date(time).toISOString();
}

export function validateHomePollPayload(
  payload: unknown,
): { ok: true; data: ValidatedHomePollInput } | { ok: false; error: string } {
  if (!isObject(payload)) {
    return { ok: false, error: "Payload JSON inválido." };
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const enabled = payload.enabled === true;
  const closesAt = normalizeDate(payload.closesAt);

  if (isObject(closesAt)) {
    return { ok: false, error: closesAt.error };
  }

  if (!question) {
    return { ok: false, error: "Escribe una pregunta." };
  }

  if (enabled && !closesAt) {
    return {
      ok: false,
      error: "La fecha de cierre debe estar en el futuro para habilitar el cuestionario.",
    };
  }

  if (enabled && closesAt && Date.parse(closesAt) <= Date.now()) {
    return {
      ok: false,
      error: "La fecha de cierre debe estar en el futuro para habilitar el cuestionario.",
    };
  }

  if (!Array.isArray(payload.options)) {
    return { ok: false, error: "Añade al menos dos opciones." };
  }

  if (payload.options.length > 32) {
    return { ok: false, error: "No puedes añadir más de 32 opciones." };
  }

  const options = payload.options.map((option, index) => {
    if (!isObject(option)) {
      return null;
    }

    const label = typeof option.label === "string" ? option.label.trim() : "";
    const id = typeof option.id === "string" && isValidUuid(option.id) ? option.id : undefined;

    if (!label) {
      return null;
    }

    return { id, label, sort_order: index };
  });

  if (options.some((option) => option === null)) {
    return { ok: false, error: "Las opciones no pueden estar vacías." };
  }

  const cleanOptions = options.filter(Boolean) as ValidatedHomePollInput["options"];

  if (cleanOptions.length < 2) {
    return { ok: false, error: "Añade al menos dos opciones." };
  }

  const duplicates = new Set<string>();

  for (const option of cleanOptions) {
    const key = option.label.toLocaleLowerCase("es");

    if (duplicates.has(key)) {
      return { ok: false, error: "No repitas opciones." };
    }

    duplicates.add(key);
  }

  return {
    ok: true,
    data: {
      question,
      closes_at: closesAt,
      enabled,
      options: cleanOptions,
    },
  };
}

export function mapHomePollRow(row: HomePollRow) {
  return {
    id: row.id,
    question: row.question,
    enabled: row.enabled,
    closesAt: row.closes_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapHomePollOptionRow(row: HomePollOptionRow) {
  return {
    id: row.id,
    pollId: row.poll_id,
    label: row.label,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}
