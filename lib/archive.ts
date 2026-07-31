export type ArchiveSection = "weeks" | "seasons";

export const ARCHIVE_PATHS: Record<ArchiveSection, string> = {
  weeks: "/archive/weeks",
  seasons: "/archive/seasons",
};

export function parseArchiveSection(value: unknown): ArchiveSection {
  return value === "seasons" ? "seasons" : "weeks";
}

export function getArchivePath(value: unknown) {
  return ARCHIVE_PATHS[parseArchiveSection(value)];
}
