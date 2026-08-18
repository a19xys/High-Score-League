const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function updateUi() {
  return import(pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "windows-update-ui.js")).href);
}

function stableState(overrides = {}) {
  return {
    accountMenuOpen: false,
    activeDialog: null,
    activeOverlay: null,
    authFormOpen: false,
    busy: false,
    libraryActivationInProgress: false,
    pendingFavoriteKeys: {},
    pendingLibraryPackId: null,
    rankingOpening: false,
    startup: { visible: false },
    windowsUpdate: { declinedThisRun: false, enabled: true, state: "available", updateVersion: "0.3.0" },
    ...overrides,
  };
}

test("available update presents only after every relevant UI authority is stable", async () => {
  const { shouldPresentWindowsUpdate, windowsUpdateDialogPatch } = await updateUi();
  assert.equal(shouldPresentWindowsUpdate(stableState()), true);
  for (const patch of [
    { busy: true },
    { activeDialog: { type: "import-pack" } },
    { activeOverlay: "activity" },
    { accountMenuOpen: true },
    { authFormOpen: true },
    { libraryActivationInProgress: true },
    { pendingLibraryPackId: "pack" },
    { pendingFavoriteKeys: { favorite: true } },
    { startup: { visible: true } },
  ]) {
    assert.equal(shouldPresentWindowsUpdate(stableState(patch)), false);
  }
  assert.equal(shouldPresentWindowsUpdate(stableState(), { themeWrites: true }), false);
  assert.equal(shouldPresentWindowsUpdate(stableState(), { libraryPreferenceWrites: true }), false);
  assert.deepEqual(windowsUpdateDialogPatch(stableState()), {
    activeDialog: { type: "windows-update", version: "0.3.0" },
  });
  assert.equal(shouldPresentWindowsUpdate(stableState({
    windowsUpdate: { declinedThisRun: true, enabled: true, state: "idle" },
  })), false);
});

test("accept closes and enters Busy synchronously, then waits theme and preferences before download", async () => {
  const { prepareAndAcceptWindowsUpdate } = await updateUi();
  const theme = {};
  theme.promise = new Promise((resolve) => { theme.resolve = resolve; });
  const events = [];
  const operation = prepareAndAcceptWindowsUpdate({
    beginBusy: () => events.push("busy"),
    waitForTheme: () => { events.push("theme-wait"); return theme.promise; },
    flushLibraryPreferences: async () => { events.push("preferences-flush"); },
    accept: async () => { events.push("download"); return { ok: true }; },
  });
  assert.deepEqual(events, ["busy", "theme-wait"]);
  theme.resolve();
  assert.deepEqual(await operation, { ok: true });
  assert.deepEqual(events, ["busy", "theme-wait", "preferences-flush", "download"]);
});

test("dialog copy, safe initial focus, decline semantics and non-catastrophic error recovery stay integrated", async () => {
  const dialogSource = await fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "app-dialog.js"), "utf8");
  const appSource = await fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8");
  assert.match(dialogSource, /Hay una nueva versión de High Score League\. ¿Quieres actualizar ahora\?/);
  assert.match(dialogSource, /action: "decline-windows-update", autofocus: true, label: "Ahora no"/);
  assert.match(dialogSource, /action: "accept-windows-update", label: "Actualizar", variant: "primary"/);
  assert.match(appSource, /activeDialog\?\.type === "windows-update"\) declineWindowsUpdate\(\)/);
  assert.match(appSource, /busyLabel: "Descargando actualización\.\.\."/);
  assert.match(appSource, /activeDialog: \{ type: "windows-update-error" \}[\s\S]*busy: false/);
  assert.match(appSource, /await prepareAndAcceptWindowsUpdate/);
  assert.match(appSource, /waitForTheme: \(\) => themeToggleQueue/);
  assert.match(appSource, /flushLibraryPreferences: flushPendingLibraryPreferences/);
});

