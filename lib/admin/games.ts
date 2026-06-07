import type { GameRow } from "@/types/supabase";
import {
  GAME_GENRES,
  GAME_PERSPECTIVES,
  GAME_THEMES,
} from "./game-taxonomy";

export type GameFormPayload = {
  title?: unknown;
  year?: unknown;
  developers?: unknown;
  publishers?: unknown;
  romName?: unknown;
  perspectives?: unknown;
  themes?: unknown;
  genres?: unknown;
  imageUrl?: unknown;
  headerImageUrl?: unknown;
  logoImageUrl?: unknown;
  accentColorPrimary?: unknown;
  accentColorSecondary?: unknown;
  instructions?: unknown;
  manualUrl?: unknown;
  downloadUrl?: unknown;
  notes?: unknown;
  controlType?: unknown;
  difficulty?: unknown;
};

export type ValidatedGamePayload =
  | {
      ok: true;
      data: {
        title: string;
        year: number | null;
        developers: string[];
        publishers: string[];
        rom_name: string | null;
        perspectives: string[];
        themes: string[];
        genres: string[];
        image_url: string | null;
        header_image_url: string | null;
        logo_image_url: string | null;
        accent_color_primary: string | null;
        accent_color_secondary: string | null;
        instructions: string | null;
        manual_url: string | null;
        download_url: string | null;
        notes: string | null;
      };
    }
  | { ok: false; error: string };

export const adminGameColumns =
  "id,title,year,developers,publishers,perspectives,themes,genres,rom_name,image_url,header_image_url,logo_image_url,accent_color_primary,accent_color_secondary,instructions,manual_url,download_url,notes,created_at,updated_at";

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

function validateOptionalUrl(value: string | null, label: string) {
  if (!value) {
    return { ok: true as const, value: null };
  }

  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return { ok: false as const, error: `${label} debe ser http o https.` };
    }

    return { ok: true as const, value };
  } catch {
    return { ok: false as const, error: `${label} debe ser una URL válida.` };
  }
}

function validateOptionalHexColor(value: string | null, label: string) {
  if (!value) {
    return { ok: true as const, value: null };
  }

  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    return { ok: false as const, error: `${label} debe tener formato #RRGGBB.` };
  }

  return { ok: true as const, value: value.toUpperCase() };
}

function validateStringArray(value: unknown, label: string) {
  if (value === undefined || value === null) {
    return { ok: true as const, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false as const, error: `${label} debe ser una lista.` };
  }

  const values: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false as const, error: `${label} solo acepta texto.` };
    }

    const trimmed = item.trim();

    if (!trimmed) {
      return { ok: false as const, error: `${label} no puede contener valores vacíos.` };
    }

    const duplicateKey = trimmed.toLocaleLowerCase("es");

    if (seen.has(duplicateKey)) {
      return { ok: false as const, error: `${label} no puede contener duplicados.` };
    }

    seen.add(duplicateKey);
    values.push(trimmed);
  }

  return { ok: true as const, value: values };
}

function validateTaxonomyArray(
  value: unknown,
  label: string,
  allowedValues: readonly string[],
) {
  const normalized = validateStringArray(value, label);

  if (!normalized.ok) {
    return normalized;
  }

  const allowed = new Set(allowedValues);
  const invalid = normalized.value.find((item) => !allowed.has(item));

  if (invalid) {
    return { ok: false as const, error: `${label} contiene un valor no permitido: ${invalid}.` };
  }

  return normalized;
}

function hasNonEmptyLegacyValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  return typeof value !== "string" || value.trim().length > 0;
}

export function validateGamePayload(payload: GameFormPayload): ValidatedGamePayload {
  if (hasNonEmptyLegacyValue(payload.controlType)) {
    return { ok: false, error: "Tipo de control ya no se usa en el catálogo." };
  }

  if (hasNonEmptyLegacyValue(payload.difficulty)) {
    return { ok: false, error: "Dificultad ya no se usa en el catálogo." };
  }

  if (typeof payload.title !== "string" || !payload.title.trim()) {
    return { ok: false, error: "El título es obligatorio." };
  }

  let year: number | null = null;
  const currentYear = new Date().getFullYear();

  if (payload.year !== undefined && payload.year !== null && payload.year !== "") {
    const parsedYear =
      typeof payload.year === "number"
        ? payload.year
        : typeof payload.year === "string"
          ? Number(payload.year)
          : Number.NaN;

    if (!Number.isInteger(parsedYear) || parsedYear < 1971 || parsedYear > currentYear) {
      return { ok: false, error: `El año debe estar entre 1971 y ${currentYear}.` };
    }

    year = parsedYear;
  }

  const developers = validateStringArray(payload.developers, "Desarrollador");
  if (!developers.ok) return { ok: false, error: developers.error };
  const publishers = validateStringArray(payload.publishers, "Editor");
  if (!publishers.ok) return { ok: false, error: publishers.error };
  const romName = optionalText(payload.romName, "ROM");
  if (!romName.ok) return { ok: false, error: romName.error };
  const perspectives = validateTaxonomyArray(
    payload.perspectives,
    "Perspectiva",
    GAME_PERSPECTIVES,
  );
  if (!perspectives.ok) return { ok: false, error: perspectives.error };
  const themes = validateTaxonomyArray(payload.themes, "Tema", GAME_THEMES);
  if (!themes.ok) return { ok: false, error: themes.error };
  const genres = validateTaxonomyArray(payload.genres, "Género", GAME_GENRES);
  if (!genres.ok) return { ok: false, error: genres.error };
  const rawImageUrl = optionalText(payload.imageUrl, "URL de imagen");
  if (!rawImageUrl.ok) return { ok: false, error: rawImageUrl.error };
  const rawHeaderImageUrl = optionalText(payload.headerImageUrl, "Header del juego");
  if (!rawHeaderImageUrl.ok) return { ok: false, error: rawHeaderImageUrl.error };
  const rawLogoImageUrl = optionalText(payload.logoImageUrl, "Logo del juego");
  if (!rawLogoImageUrl.ok) return { ok: false, error: rawLogoImageUrl.error };
  const rawAccentColorPrimary = optionalText(
    payload.accentColorPrimary,
    "Color principal del logo",
  );
  if (!rawAccentColorPrimary.ok) {
    return { ok: false, error: rawAccentColorPrimary.error };
  }
  const rawAccentColorSecondary = optionalText(
    payload.accentColorSecondary,
    "Color secundario del logo",
  );
  if (!rawAccentColorSecondary.ok) {
    return { ok: false, error: rawAccentColorSecondary.error };
  }
  const instructions = optionalText(payload.instructions, "Instrucciones");
  if (!instructions.ok) return { ok: false, error: instructions.error };
  const rawManualUrl = optionalText(payload.manualUrl, "URL del manual");
  if (!rawManualUrl.ok) return { ok: false, error: rawManualUrl.error };
  const rawDownloadUrl = optionalText(
    payload.downloadUrl,
    "URL de descarga del juego",
  );
  if (!rawDownloadUrl.ok) {
    return { ok: false, error: rawDownloadUrl.error };
  }
  const notes = optionalText(payload.notes, "Notas");
  if (!notes.ok) return { ok: false, error: notes.error };

  const imageUrl = validateOptionalUrl(rawImageUrl.value, "URL de imagen");

  if (!imageUrl.ok) {
    return { ok: false, error: imageUrl.error };
  }

  const headerImageUrl = validateOptionalUrl(rawHeaderImageUrl.value, "Header del juego");

  if (!headerImageUrl.ok) {
    return { ok: false, error: headerImageUrl.error };
  }

  const logoImageUrl = validateOptionalUrl(rawLogoImageUrl.value, "Logo del juego");

  if (!logoImageUrl.ok) {
    return { ok: false, error: logoImageUrl.error };
  }

  const accentColorPrimary = validateOptionalHexColor(
    rawAccentColorPrimary.value,
    "Color principal del logo",
  );

  if (!accentColorPrimary.ok) {
    return { ok: false, error: accentColorPrimary.error };
  }

  const accentColorSecondary = validateOptionalHexColor(
    rawAccentColorSecondary.value,
    "Color secundario del logo",
  );

  if (!accentColorSecondary.ok) {
    return { ok: false, error: accentColorSecondary.error };
  }

  const manualUrl = validateOptionalUrl(rawManualUrl.value, "URL del manual");

  if (!manualUrl.ok) {
    return { ok: false, error: manualUrl.error };
  }

  const downloadUrl = validateOptionalUrl(
    rawDownloadUrl.value,
    "URL de descarga del juego",
  );

  if (!downloadUrl.ok) {
    return { ok: false, error: downloadUrl.error };
  }

  return {
    ok: true,
    data: {
      title: payload.title.trim(),
      year,
      developers: developers.value,
      publishers: publishers.value,
      rom_name: romName.value,
      perspectives: perspectives.value,
      themes: themes.value,
      genres: genres.value,
      image_url: imageUrl.value,
      header_image_url: headerImageUrl.value,
      logo_image_url: logoImageUrl.value,
      accent_color_primary: accentColorPrimary.value,
      accent_color_secondary: accentColorSecondary.value,
      instructions: instructions.value,
      manual_url: manualUrl.value,
      download_url: downloadUrl.value,
      notes: notes.value,
    },
  };
}

export function isGameRow(value: unknown): value is GameRow {
  return Boolean(value && typeof value === "object" && "id" in value);
}
