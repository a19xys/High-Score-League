export type ArchiveSection = "weeks" | "seasons";

export const ARCHIVE_PATHS: Record<ArchiveSection, string> = {
  weeks: "/archive/weeks",
  seasons: "/archive/seasons",
};

export function parseArchiveSection(value: unknown): ArchiveSection | null {
  return value === "weeks" || value === "seasons" ? value : null;
}

export function getArchivePath(value: unknown) {
  const section = parseArchiveSection(value);

  return section ? ARCHIVE_PATHS[section] : "/archive";
}
