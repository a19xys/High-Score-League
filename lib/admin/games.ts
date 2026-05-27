import type { GameRow } from "@/types/supabase";

export type GameFormPayload = {
  title?: unknown;
  year?: unknown;
  developer?: unknown;
  publisher?: unknown;
  romName?: unknown;
  genre?: unknown;
  controlType?: unknown;
  difficulty?: unknown;
  imageUrl?: unknown;
  notes?: unknown;
};

export type ValidatedGamePayload =
  | {
      ok: true;
      data: {
        title: string;
        year: number | null;
        developer: string | null;
        publisher: string | null;
        rom_name: string | null;
        genre: string | null;
        control_type: string | null;
        difficulty: string | null;
        image_url: string | null;
        notes: string | null;
      };
    }
  | { ok: false; error: string };

export const adminGameColumns =
  "id,title,year,developer,publisher,rom_name,genre,control_type,difficulty,image_url,notes,created_at,updated_at";

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

function validateOptionalUrl(value: string | null) {
  if (!value) {
    return { ok: true as const, value: null };
  }

  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return { ok: false as const, error: "image_url debe ser http o https." };
    }

    return { ok: true as const, value };
  } catch {
    return { ok: false as const, error: "image_url debe ser una URL válida." };
  }
}

export function validateGamePayload(payload: GameFormPayload): ValidatedGamePayload {
  if (typeof payload.title !== "string" || !payload.title.trim()) {
    return { ok: false, error: "title es obligatorio." };
  }

  let year: number | null = null;

  if (payload.year !== undefined && payload.year !== null && payload.year !== "") {
    const parsedYear =
      typeof payload.year === "number"
        ? payload.year
        : typeof payload.year === "string"
          ? Number(payload.year)
          : Number.NaN;

    if (!Number.isInteger(parsedYear) || parsedYear < 1970 || parsedYear > 2100) {
      return { ok: false, error: "year debe estar entre 1970 y 2100." };
    }

    year = parsedYear;
  }

  const developer = optionalText(payload.developer, "developer");
  if (!developer.ok) return { ok: false, error: developer.error };
  const publisher = optionalText(payload.publisher, "publisher");
  if (!publisher.ok) return { ok: false, error: publisher.error };
  const romName = optionalText(payload.romName, "rom_name");
  if (!romName.ok) return { ok: false, error: romName.error };
  const genre = optionalText(payload.genre, "genre");
  if (!genre.ok) return { ok: false, error: genre.error };
  const controlType = optionalText(payload.controlType, "control_type");
  if (!controlType.ok) return { ok: false, error: controlType.error };
  const difficulty = optionalText(payload.difficulty, "difficulty");
  if (!difficulty.ok) return { ok: false, error: difficulty.error };
  const rawImageUrl = optionalText(payload.imageUrl, "image_url");
  if (!rawImageUrl.ok) return { ok: false, error: rawImageUrl.error };
  const notes = optionalText(payload.notes, "notes");
  if (!notes.ok) return { ok: false, error: notes.error };

  const imageUrl = validateOptionalUrl(rawImageUrl.value);

  if (!imageUrl.ok) {
    return { ok: false, error: imageUrl.error };
  }

  return {
    ok: true,
    data: {
      title: payload.title.trim(),
      year,
      developer: developer.value,
      publisher: publisher.value,
      rom_name: romName.value,
      genre: genre.value,
      control_type: controlType.value,
      difficulty: difficulty.value,
      image_url: imageUrl.value,
      notes: notes.value,
    },
  };
}

export function isGameRow(value: unknown): value is GameRow {
  return Boolean(value && typeof value === "object" && "id" in value);
}
