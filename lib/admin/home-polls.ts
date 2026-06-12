import type {
  HomePollOptionRow,
  HomePollRow,
} from "@/types/supabase";

export type AdminHomePollOptionInput = {
  id?: string | null;
  label: string;
  imageUrl?: string | null;
};

export type AdminHomePollInput = {
  question: string;
  closesDate: string | null;
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
    image_url: string | null;
    sort_order: number;
  }>;
};

export const homePollColumns =
  "id,singleton_key,question,enabled,closes_at,created_at,updated_at";

export const homePollOptionColumns =
  "id,poll_id,label,image_url,sort_order,created_at";

const madridTimeZone = "Europe/Madrid";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeImageUrl(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return { error: "La imagen de cada opción debe ser una URL válida." } as const;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { error: "La imagen debe empezar por http:// o https://." } as const;
  }

  return trimmed;
}

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return (
    Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    ) - date.getTime()
  );
}

function madridDateToEndOfDayIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return { error: "La fecha de cierre no es válida." } as const;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const targetUtc = Date.UTC(year, month - 1, day, 23, 59, 59);
  let instant = targetUtc;

  for (let index = 0; index < 2; index += 1) {
    const offset = getTimeZoneOffsetMs(madridTimeZone, new Date(instant));
    instant = targetUtc - offset;
  }

  return new Date(instant).toISOString();
}

export function formatMadridDateInput(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: madridTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeCloseDate(payload: Record<string, unknown>) {
  const closesDate = payload.closesDate;

  if (closesDate === null || closesDate === undefined || closesDate === "") {
    return null;
  }

  if (typeof closesDate === "string") {
    return madridDateToEndOfDayIso(closesDate);
  }

  return { error: "La fecha de cierre no es válida." } as const;
}

function normalizeLegacyDate(value: unknown) {
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
  const closesAt =
    "closesDate" in payload
      ? normalizeCloseDate(payload)
      : normalizeLegacyDate(payload.closesAt);

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
    const imageUrl = normalizeImageUrl(option.imageUrl);
    const id = typeof option.id === "string" && isValidUuid(option.id) ? option.id : undefined;

    if (!label) {
      return null;
    }

    if (label.length > 80) {
      return { error: "Cada opción puede tener como máximo 80 caracteres." } as const;
    }

    if (isObject(imageUrl)) {
      return imageUrl;
    }

    return { id, label, image_url: imageUrl, sort_order: index };
  });

  if (options.some((option) => option === null)) {
    return { ok: false, error: "Las opciones no pueden estar vacías." };
  }

  const optionError = options.find(
    (option) => option !== null && "error" in option,
  );

  if (optionError) {
    return {
      ok: false,
      error:
        typeof optionError.error === "string"
          ? optionError.error
          : "No se pudo validar una opción.",
    };
  }

  const cleanOptions = options.filter(
    (
      option,
    ): option is ValidatedHomePollInput["options"][number] =>
      option !== null && !("error" in option),
  );

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

  const imagesCount = cleanOptions.filter((option) => option.image_url).length;

  if (imagesCount > 0 && imagesCount < cleanOptions.length) {
    return {
      ok: false,
      error:
        "Si usas imágenes, todas las opciones deben tener una imagen. Si no, deja todas las imágenes vacías.",
    };
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
    imageUrl: row.image_url,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}
