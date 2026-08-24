const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const INTENT_ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;
const INTENT_STATUSES = new Set([
  "already-current",
  "current-unverified",
  "normal-import",
  "revision-conflict",
  "target-not-current",
  "update-available",
]);

export function normalizePackImportIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "intentId,libraryReady,packId,status,title") return null;
  if (!INTENT_ID_PATTERN.test(value.intentId || "") || !PACK_ID_PATTERN.test(value.packId || "")) return null;
  if (typeof value.libraryReady !== "boolean" || !INTENT_STATUSES.has(value.status)) return null;
  if (value.title !== null && typeof value.title !== "string") return null;
  return Object.freeze({
    intentId: value.intentId,
    libraryReady: value.libraryReady,
    packId: value.packId,
    status: value.status,
    title: value.title,
  });
}

export function isPackImportUiStable(state = {}, pending = {}) {
  const updateWaiting = state.windowsUpdate?.enabled === true
    && state.windowsUpdate?.state === "available"
    && state.windowsUpdate?.declinedThisRun !== true;
  return state.busy !== true
    && !state.activeDialog
    && !state.activeOverlay
    && state.accountMenuOpen !== true
    && state.authFormOpen !== true
    && state.libraryActivationInProgress !== true
    && !state.pendingLibraryPackId
    && state.rankingOpening !== true
    && state.startup?.visible === false
    && Object.keys(state.pendingFavoriteKeys || {}).length === 0
    && pending.themeWrites !== true
    && pending.libraryPreferenceWrites !== true
    && !updateWaiting;
}

export function packImportIntentDialog(value) {
  const intent = normalizePackImportIntent(value);
  return intent ? { ...intent, type: "pack-deeplink" } : null;
}

export function packImportResultDialog(status) {
  const allowed = new Set([
    "already-installed",
    "already-current",
    "cancelled",
    "download-integrity-failed",
    "imported",
    "installation-conflict",
    "invalid-pack",
    "offline",
    "pack-unavailable",
    "operation-busy",
    "remote-error",
    "requires-login",
    "revision-conflict",
    "target-not-current",
    "unexpected-pack-id",
    "updated",
    "verified",
  ]);
  return { status: allowed.has(status) ? status : "remote-error", type: "pack-deeplink-result" };
}
