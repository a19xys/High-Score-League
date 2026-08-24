const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

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
    windowsUpdate: { declinedThisRun: false, enabled: false, state: "disabled" },
    ...overrides,
  };
}

async function ui() {
  return import(pathToFileURL(path.join(rendererRoot, "pack-deeplink-ui.js")).href);
}

test("presentación deep-link espera busy, MAME, modal, overlay y actualización", async () => {
  const { isPackImportUiStable } = await ui();
  assert.equal(isPackImportUiStable(stableState()), true);
  for (const state of [
    stableState({ busy: true }),
    stableState({ busy: true, busyLabel: "Competición en curso" }),
    stableState({ activeDialog: { type: "import-pack" } }),
    stableState({ activeOverlay: "advanced" }),
    stableState({ authFormOpen: true }),
    stableState({ libraryActivationInProgress: true }),
    stableState({ windowsUpdate: { declinedThisRun: false, enabled: true, state: "available" } }),
  ]) assert.equal(isPackImportUiStable(state), false);
  assert.equal(isPackImportUiStable(stableState(), { themeWrites: true }), false);
});

test("intent renderer sólo conserva identidad y clasificación local cerrada", async () => {
  const { normalizePackImportIntent, packImportIntentDialog } = await ui();
  const value = {
    intentId: "93cfad43-c925-4b38-b8fb-8058bf77431d",
    libraryReady: true,
    packId: "space-invaders",
    status: "normal-import",
    title: null,
  };
  assert.deepEqual(normalizePackImportIntent(value), value);
  assert.deepEqual(packImportIntentDialog(value), { ...value, type: "pack-deeplink" });
  assert.equal(normalizePackImportIntent({ ...value, packId: "../secret" }), null);
  assert.equal(normalizePackImportIntent({ ...value, downloadUrl: "https://secret.example" }), null);
});

test("diálogos deep-link son modales accesibles y tienen acciones de producto", async () => {
  const { renderAppDialog } = await import(pathToFileURL(path.join(rendererRoot, "components", "app-dialog.js")).href);
  const base = {
    intentId: "intent-1",
    libraryReady: true,
    packId: "space-invaders",
    status: "normal-import",
    title: null,
    type: "pack-deeplink",
  };
  const confirm = renderAppDialog({ activeDialog: base });
  const installed = renderAppDialog({ activeDialog: { ...base, status: "already-current" } });
  const update = renderAppDialog({ activeDialog: { ...base, status: "update-available", title: "Space Invaders" } });
  const library = renderAppDialog({ activeDialog: { ...base, libraryReady: false } });
  const success = renderAppDialog({ activeDialog: { status: "imported", type: "pack-deeplink-result" } });
  for (const html of [confirm, installed, update, library, success]) {
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /data-dialog-initial-focus/);
  }
  assert.match(confirm, /¿Quieres añadir este pack a tu biblioteca\?/);
  assert.match(confirm, /data-action="cancel-pack-deeplink"/);
  assert.match(confirm, /data-action="accept-pack-deeplink"/);
  assert.match(installed, /Pack actualizado/);
  assert.match(update, /Hay una nueva versión de Space Invaders/);
  assert.match(update, /Actualizar/);
  assert.match(library, /data-action="choose-pack-deeplink-library"/);
  assert.match(success, /Pack añadido/);
});

test("app difiere por estado, no hace polling y cancela semánticamente Escape/backdrop", async () => {
  const source = await fsp.readFile(path.join(rendererRoot, "app.js"), "utf8");
  assert.match(source, /isPackImportUiStable\(store\.getState\(\), windowsUpdatePendingWrites\(\)\)/);
  assert.match(source, /onPackImportIntentAvailable/);
  assert.match(source, /getPendingPackImportIntent/);
  assert.match(source, /cancelPresentedPackImportIntent/);
  assert.match(source, /state\.activeDialog\?\.type === "pack-deeplink"/);
  assert.doesNotMatch(source, /setInterval\([^)]*packImport/i);
});

test("preload mantiene IPC semántico sin URL, path o token", async () => {
  const preload = await fsp.readFile(path.join(rendererRoot, "..", "preload.js"), "utf8");
  for (const method of [
    "getPendingPackImportIntent",
    "onPackImportIntentAvailable",
    "acceptPackImportIntent",
    "cancelPackImportIntent",
  ]) assert.match(preload, new RegExp(`${method}:`));
  assert.doesNotMatch(preload, /handleDeepLink|downloadUrl\s*:|importPath\s*:|openUrl\s*:/);
  assert.doesNotMatch(preload, /access[_-]?token|Authorization|objectKey/);
});
