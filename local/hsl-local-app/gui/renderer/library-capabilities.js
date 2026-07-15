const VALID_LIBRARY_STATUSES = new Set(["available-empty", "available-populated"]);
const INVALID_ROOT_CLASSIFICATIONS = new Set([
  "inside-pack",
  "inaccessible",
  "invalid-file",
  "missing",
  "pack-root",
  "unsupported-layout",
]);

export function getLibraryCapabilities(state = {}) {
  const library = state.data?.library || state.library || {};
  const directory = library.directory || {};
  const structurallyAvailable = VALID_LIBRARY_STATUSES.has(library.status) || Boolean(
    directory.path &&
    directory.available &&
    !INVALID_ROOT_CLASSIFICATIONS.has(directory.classification)
  );

  return {
    filtersEnabled: structurallyAvailable,
    structuralStatus: library.status || directory.status || "unconfigured",
    viewsEnabled: structurallyAvailable,
  };
}
