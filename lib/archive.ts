export type ArchiveSection = "weeks" | "seasons";

export function parseArchiveSection(value: unknown): ArchiveSection {
  return value === "seasons" ? "seasons" : "weeks";
}
