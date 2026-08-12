const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const {
  applyLibraryLocationCandidate,
  showLibraryLocationDialog,
} = require("../gui/library-location-dialog");
const {
  choosePackDirectoryFromGui,
  getLibraryLocationSelectionContext,
  resetLibrarySnapshotAuthorityForTests,
} = require("../gui/launcher-service");
const { writeLibraryLocations } = require("../src/library-locations");
const { readPackDirectory, setPackDirectory } = require("../src/pack-directory");

async function withTempDir(run) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-library-location-"));
  try {
    return await run(directory);
  } finally {
    await fsp.rm(directory, { force: true, recursive: true });
  }
}

async function makePack(packRoot) {
  await fsp.mkdir(packRoot, { recursive: true });
  await fsp.writeFile(path.join(packRoot, "pack.json"), "{}", "utf8");
}

test("el contexto del selector procede solo de la raíz canónica y conserva missing", async () => {
  await withTempDir(async (directory) => {
    resetLibrarySnapshotAuthorityForTests();
    const config = { userDataDir: path.join(directory, "user-data") };
    const rootA = path.join(directory, "library-a");
    const rootB = path.join(directory, "library-b");
    const externalPack = path.join(directory, "external", "SpaceInvaders");
    await fsp.mkdir(rootA, { recursive: true });
    await makePack(path.join(rootB, "Galaga"));
    await makePack(externalPack);
    await setPackDirectory(config, rootA);

    const stable = await getLibraryLocationSelectionContext({
      activePack: { packDir: externalPack },
      config,
      selection: { activePackDir: externalPack },
    });
    assert.equal(stable.defaultPath, path.resolve(rootA));

    const rejected = await choosePackDirectoryFromGui(path.join(rootB, "Galaga"), {
      config,
      includeState: false,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.result.classification, "pack-root");
    assert.equal((await getLibraryLocationSelectionContext({ config })).defaultPath, path.resolve(rootA));

    const accepted = await choosePackDirectoryFromGui(rejected.result.suggestedRootPath, {
      config,
      includeState: false,
    });
    assert.equal(accepted.ok, true);
    assert.equal((await getLibraryLocationSelectionContext({ config })).defaultPath, path.resolve(rootB));

    await fsp.rm(rootB, { force: true, recursive: true });
    const missing = await getLibraryLocationSelectionContext({ config });
    assert.equal(missing.classification, "missing");
    assert.equal(missing.defaultPath, path.resolve(rootB));
  });
});

test("sin raíz el diálogo omite defaultPath y con raíz envía la opción real a Electron", async () => {
  const calls = [];
  const dialog = {
    async showOpenDialog(parentWindow, options) {
      calls.push({ options, parentWindow });
      return { canceled: true, filePaths: [] };
    },
  };
  const parentWindow = { id: "window" };

  await showLibraryLocationDialog({
    dialog,
    getSelectionContext: async () => ({ defaultPath: "C:\\HSL\\Packs" }),
    parentWindow,
  });
  await showLibraryLocationDialog({
    dialog,
    getSelectionContext: async () => ({ defaultPath: null }),
    parentWindow,
  });

  assert.equal(calls[0].parentWindow, parentWindow);
  assert.equal(calls[0].options.defaultPath, "C:\\HSL\\Packs");
  assert.deepEqual(calls[0].options.properties, ["openDirectory"]);
  assert.equal(Object.hasOwn(calls[1].options, "defaultPath"), false);
});

test("una ubicacion legacy no se convierte en defaultPath sin raiz canonica", async () => {
  await withTempDir(async (directory) => {
    const config = { userDataDir: path.join(directory, "user-data") };
    const legacyRoot = path.join(directory, "legacy-library");
    await fsp.mkdir(legacyRoot, { recursive: true });
    await writeLibraryLocations(config, [{ addedAt: "2026-01-01T00:00:00.000Z", path: legacyRoot }]);

    const context = await getLibraryLocationSelectionContext({ config });
    assert.equal(context.configured, false);
    assert.equal(context.defaultPath, null);
  });
});

test("cancelar o rechazar no abre un lifecycle de mutación; aceptar sí", async () => {
  const calls = { acceptedMutation: 0, acceptedState: 0, stableState: 0 };
  const common = {
    readAcceptedState: async () => {
      calls.acceptedState += 1;
      return { root: "B" };
    },
    readStableState: async () => {
      calls.stableState += 1;
      return { root: "A" };
    },
    runAcceptedMutation: async (operation) => {
      calls.acceptedMutation += 1;
      return operation();
    },
  };

  const rejected = await applyLibraryLocationCandidate({
    ...common,
    chooseCandidate: async () => ({ canceled: false, ok: false }),
    directoryPath: "rejected",
  });
  assert.deepEqual(rejected.state, { root: "A" });
  assert.deepEqual(calls, { acceptedMutation: 0, acceptedState: 0, stableState: 1 });

  const accepted = await applyLibraryLocationCandidate({
    ...common,
    chooseCandidate: async () => ({ ok: true }),
    directoryPath: "accepted",
  });
  assert.deepEqual(accepted.state, { root: "B" });
  assert.deepEqual(calls, { acceptedMutation: 1, acceptedState: 1, stableState: 1 });
});

test("cancel, reject y accept conservan la raíz A, A y B respectivamente", async () => {
  await withTempDir(async (directory) => {
    const config = { userDataDir: path.join(directory, "user-data") };
    const rootA = path.join(directory, "root-a");
    const rootB = path.join(directory, "root-b");
    await fsp.mkdir(rootA, { recursive: true });
    await makePack(path.join(rootB, "Pack-B"));
    await setPackDirectory(config, rootA);

    assert.equal((await readPackDirectory(config)).directoryPath, path.resolve(rootA));
    const rejected = await choosePackDirectoryFromGui(path.join(rootB, "Pack-B"), { config, includeState: false });
    assert.equal(rejected.ok, false);
    assert.equal((await readPackDirectory(config)).directoryPath, path.resolve(rootA));
    const accepted = await choosePackDirectoryFromGui(rootB, { config, includeState: false });
    assert.equal(accepted.ok, true);
    assert.equal((await readPackDirectory(config)).directoryPath, path.resolve(rootB));
  });
});

test("el diálogo unificado cubre candidatas y raíces recordadas no disponibles", async () => {
  const { renderAppDialog } = await import(pathToFileURL(
    path.join(__dirname, "..", "gui", "renderer", "components", "app-dialog.js"),
  ).href);
  const expectations = new Map([
    ["pack-root", /carpeta de un pack/],
    ["inside-pack", /forma parte de un pack/],
    ["unsupported-layout", /demasiado profundos/],
    ["missing", /No se encuentra esta carpeta/],
    ["inaccessible", /No se puede acceder a esta carpeta/],
    ["invalid-file", /Elige una carpeta/],
  ]);

  for (const [classification, copy] of expectations) {
    const html = renderAppDialog({
      activeDialog: { classification, issue: "rejected-candidate", type: "library-location" },
    });
    assert.match(html, copy);
    assert.match(html, /data-action="choose-library-location"[\s\S]*Volver a elegir/);
    assert.match(html, /data-action="close-dialog"[\s\S]*Cancelar/);
    assert.doesNotMatch(html, /use-suggested-library-root/);
  }

  const suggested = renderAppDialog({
    activeDialog: {
      classification: "inside-pack",
      issue: "rejected-candidate",
      suggestedRootPath: "C:\\HSL\\Packs",
      type: "library-location",
    },
  });
  assert.match(suggested, /data-action="use-suggested-library-root"[\s\S]*Usar carpeta superior/);

  for (const classification of ["missing", "inaccessible"]) {
    const html = renderAppDialog({
      activeDialog: { classification, issue: "current-root-unavailable", type: "library-location" },
    });
    assert.match(html, /data-action="retry-library-location"[\s\S]*Reintentar/);
    assert.match(html, /data-action="choose-library-location"[\s\S]*Elegir otra carpeta/);
    assert.match(html, /data-action="close-dialog"[\s\S]*Cancelar/);
  }

  assert.equal(renderAppDialog({ activeDialog: { type: "library-root-rejected" } }), "");
  assert.equal(renderAppDialog({ activeDialog: { type: "pack-directory-unavailable" } }), "");
});

test("Biblioteca es encabezado y Abrir/Reescanear comparten la autoridad de acciones", async () => {
  const { renderLibraryControls, renderLibraryHeading } = await import(pathToFileURL(
    path.join(__dirname, "..", "gui", "renderer", "components", "library-panel.js"),
  ).href);
  const state = (available) => ({
    busy: false,
    data: {
      library: {
        directory: { available, configured: true, path: "C:/HSL/Packs" },
        packs: [],
        status: available ? "available-empty" : "missing",
        totals: { packs: 0 },
      },
      session: { hasSession: false },
    },
    libraryFiltersOpen: false,
    libraryView: "covers",
  });
  const availableHeading = renderLibraryHeading(state(true));
  const unavailableHeading = renderLibraryHeading(state(false));
  const controls = renderLibraryControls(state(false), []);

  assert.match(availableHeading, /<h2 class="library-heading-title">[\s\S]*Biblioteca[\s\S]*<\/h2>/);
  assert.match(availableHeading, /data-action="open-pack-directory"[^>]*aria-label="Abrir carpeta de packs"/);
  assert.match(availableHeading, /data-action="rescan-pack-directory"[^>]*aria-label="Reescanear biblioteca"/);
  assert.doesNotMatch(availableHeading, /library-open-control/);
  assert.doesNotMatch(availableHeading.match(/<h2[\s\S]*?<\/h2>/)?.[0] || "", /data-action|<button/);
  assert.doesNotMatch(availableHeading.match(/data-action="open-pack-directory"[^>]*>/)?.[0] || "", /disabled/);
  assert.match(unavailableHeading.match(/data-action="open-pack-directory"[^>]*>/)?.[0] || "", /disabled/);
  assert.match(unavailableHeading.match(/data-action="rescan-pack-directory"[^>]*>/)?.[0] || "", /disabled/);
  assert.doesNotMatch(controls.match(/data-action="choose-pack-directory"[^>]*>/)?.[0] || "", /disabled/);
});
