export const PROFILE_SECTION_IDS = [
  "resumen",
  "envios",
  "editar",
  "cuenta",
  "administracion",
] as const;

export type ProfileSectionId = (typeof PROFILE_SECTION_IDS)[number];

const legacySectionAliases: Record<string, ProfileSectionId> = {
  trayectoria: "resumen",
  "editar-perfil": "editar",
  "centro-admin": "administracion",
};

export function resolveProfileSection(
  hash: string,
  availableSections: readonly ProfileSectionId[],
): ProfileSectionId {
  let normalized: string;

  try {
    normalized = decodeURIComponent(hash.replace(/^#/, "")).toLowerCase();
  } catch {
    return "resumen";
  }
  const candidate =
    legacySectionAliases[normalized] ??
    (PROFILE_SECTION_IDS.includes(normalized as ProfileSectionId)
      ? (normalized as ProfileSectionId)
      : "resumen");

  return availableSections.includes(candidate) ? candidate : "resumen";
}
