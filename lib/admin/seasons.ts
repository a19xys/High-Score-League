import type { SeasonStatus } from "@/types";

export type SeasonFormPayload = {
  name?: unknown;
  slug?: unknown;
  version?: unknown;
  status?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
};

export type ValidatedSeasonPayload =
  | {
      ok: true;
      data: {
        name: string;
        slug: string;
        version: string | null;
        status: SeasonStatus;
        starts_at: string | null;
        ends_at: string | null;
      };
    }
  | { ok: false; error: string };

export const adminSeasonColumns =
  "id,name,slug,version,status,starts_at,ends_at,created_at,updated_at";

const allowedStatuses = new Set<SeasonStatus>(["draft", "active", "completed"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const zonedDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function optionalText(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return { ok: true as const, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false as const, error: `${label} debe ser texto.` };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: true as const, value: null };
  }

  return { ok: true as const, value: trimmed };
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

  const timestamp = new Date(text.value).getTime();

  if (Number.isNaN(timestamp)) {
    return { ok: false as const, error: `${label} debe ser una fecha válida.` };
  }

  return { ok: true as const, value: text.value };
}

export function validateSeasonPayload(
  payload: SeasonFormPayload,
): ValidatedSeasonPayload {
  if (typeof payload.name !== "string" || !payload.name.trim()) {
    return { ok: false, error: "name es obligatorio." };
  }

  if (typeof payload.slug !== "string" || !payload.slug.trim()) {
    return { ok: false, error: "slug es obligatorio." };
  }

  const slug = payload.slug.trim();

  if (!slugPattern.test(slug)) {
    return {
      ok: false,
      error: "slug debe usar minúsculas, números y guiones, sin espacios.",
    };
  }

  if (typeof payload.status !== "string" || !allowedStatuses.has(payload.status as SeasonStatus)) {
    return { ok: false, error: "status no permitido." };
  }

  const version = optionalText(payload.version, "version");
  if (!version.ok) return { ok: false, error: version.error };
  const startsAt = optionalZonedDateTime(payload.startsAt, "starts_at");
  if (!startsAt.ok) return { ok: false, error: startsAt.error };
  const endsAt = optionalZonedDateTime(payload.endsAt, "ends_at");
  if (!endsAt.ok) return { ok: false, error: endsAt.error };

  if (
    startsAt.value &&
    endsAt.value &&
    new Date(startsAt.value).getTime() > new Date(endsAt.value).getTime()
  ) {
    return { ok: false, error: "starts_at debe ser anterior o igual a ends_at." };
  }

  return {
    ok: true,
    data: {
      name: payload.name.trim(),
      slug,
      version: version.value,
      status: payload.status as SeasonStatus,
      starts_at: startsAt.value,
      ends_at: endsAt.value,
    },
  };
}
