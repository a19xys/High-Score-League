const path = require("node:path");

function resolveHslUserDataDir(electronUserDataDir, environment = process.env) {
  const electronRoot = typeof electronUserDataDir === "string" ? electronUserDataDir.trim() : "";
  if (!electronRoot) throw new Error("Electron userData es obligatorio.");
  const override = typeof environment?.HSL_USER_DATA_DIR === "string"
    ? environment.HSL_USER_DATA_DIR.trim()
    : "";
  return path.resolve(override || electronRoot);
}

function describeHslUserDataIsolation(electronUserDataDir, hslUserDataDir, environment = process.env) {
  const electronRoot = path.resolve(electronUserDataDir);
  const hslRoot = path.resolve(hslUserDataDir);
  const overrideActive = typeof environment?.HSL_USER_DATA_DIR === "string"
    && Boolean(environment.HSL_USER_DATA_DIR.trim());
  return Object.freeze({
    electronProfileIsolated: !overrideActive || electronRoot !== hslRoot,
    hslRootMatchesOverride: !overrideActive || hslRoot === path.resolve(environment.HSL_USER_DATA_DIR.trim()),
    overrideActive,
    rootsDiffer: electronRoot !== hslRoot,
  });
}

module.exports = { describeHslUserDataIsolation, resolveHslUserDataDir };
