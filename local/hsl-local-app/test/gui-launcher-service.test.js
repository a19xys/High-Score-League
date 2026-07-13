const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  adoptNewStagingEvents,
  activateLibraryPack,
  classifyFailureReason,
  chooseSharedMameRuntimeFromGui,
  choosePackDirectoryFromGui,
  deriveOpenedPackConfig,
  eventResultToQueueItem,
  getLauncherState,
  importPackFromFolderForGui,
  importPackFromZipForGui,
  listPendingFileSnapshot,
  openConfiguredPackDirectory,
  openPackManual,
  openPackRanking,
  openSharedMameRuntimeDirectory,
  readPackForGui,
  recheckSeasonMembership,
  resolveRememberedPack,
  rescanPackDirectory,
  resetAutoSyncStateForTests,
  runAutoSyncIfEligible,
  runDiagnose,
  setLibraryPreferencesFromGui,
  summarizeDiagnoseReport,
  toggleLibraryFavoriteFromGui,
} = require("../gui/launcher-service");
const { setPackDirectory, writePackDirectory } = require("../src/pack-directory");
const { scanPackLibrary } = require("../src/pack-library");
const { writeLastOpenedPack } = require("../src/recent-packs");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-gui-pack-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function writeValidPack(root) {
  const packDir = path.join(root, "hsl-invaders");
  await fsp.mkdir(packDir, { recursive: true });
  await fsp.writeFile(path.join(packDir, "pack.json"), JSON.stringify(validPack()), "utf8");
  return packDir;
}

function validPack() {
  return {
    packVersion: 1,
    packId: "space-invaders-week-1",
    gameId: "space-invaders",
    rom: "invaders",
    weekId: "week-1",
    webBaseUrl: "https://high-score-league.example",
    mame: {
      relativeExecutablePath: "mame/mame.exe",
      workingDir: "mame",
      pluginName: "hsl-score",
    },
    plugin: {
      name: "hsl-score",
    },
  };
}

function validV2Pack() {
  return {
    packVersion: 2,
    packId: "space-invaders-season-1-week-1",
    gameId: "space-invaders",
    rom: "invaders",
    seasonId: "season-1",
    seasonSlug: "season-1",
    seasonName: "Temporada 1",
    weekId: "week-1",
    weekNumber: 1,
    webBaseUrl: "https://high-score-league.example",
    runtime: {
      type: "mame",
      minVersion: "0.287",
      recommendedVersion: "0.287",
    },
    mame: {
      romPath: "roms",
      artworkPath: "artwork",
      samplePath: "samples",
      cfgPath: "cfg",
      launchArgs: [],
    },
    capture: {
      mode: "plugin",
      pluginName: "hsl-score",
      adapter: "scripts/invaders.lua",
    },
  };
}

async function writeValidV2PackDir(packDir, overrides = {}) {
  await fsp.mkdir(path.join(packDir, "roms"), { recursive: true });
  await fsp.writeFile(path.join(packDir, "pack.json"), JSON.stringify({
    ...validV2Pack(),
    ...overrides,
  }), "utf8");
  await fsp.writeFile(path.join(packDir, "roms", "invaders.zip"), "rom", "utf8");
  await fsp.mkdir(path.join(packDir, "scripts"), { recursive: true });
  await fsp.writeFile(path.join(packDir, "scripts", "invaders.lua"), "-- adapter", "utf8");
}

async function createDiagnoseGuiConfig(root) {
  const userDataDir = path.join(root, "userData");
  const eventsBaseDirAbs = path.join(userDataDir, "events");
  const eventsPendingDirAbs = path.join(eventsBaseDirAbs, "pending");
  const eventsSentDirAbs = path.join(eventsBaseDirAbs, "sent");
  const eventsFailedDirAbs = path.join(eventsBaseDirAbs, "failed");
  const mameRoot = path.join(root, "mame");
  const executablePath = path.join(mameRoot, "mame.exe");
  const pluginDir = path.join(mameRoot, "plugins", "hsl-score");
  const packRoot = path.join(root, "active-pack");
  const pack = {
    ...validPack(),
    packRoot,
    packPath: path.join(packRoot, "pack.json"),
  };

  await fsp.mkdir(eventsPendingDirAbs, { recursive: true });
  await fsp.mkdir(eventsSentDirAbs, { recursive: true });
  await fsp.mkdir(eventsFailedDirAbs, { recursive: true });
  await fsp.mkdir(pluginDir, { recursive: true });
  await fsp.mkdir(packRoot, { recursive: true });
  await fsp.writeFile(executablePath, "", "utf8");
  await fsp.writeFile(pack.packPath, JSON.stringify(validPack()), "utf8");
  await fsp.writeFile(
    path.join(userDataDir, "session.json"),
    JSON.stringify({
      schemaVersion: 1,
      user: { id: "user-1234567890", email: "player@example.com" },
      session: {
        access_token: "secret-access-token",
        refresh_token: "secret-refresh-token",
      },
    }),
    "utf8"
  );

  return {
    appDir: root,
    clientVersion: "0.1.0-test",
    configExists: false,
    configPath: path.join(root, "config.json"),
    configSource: "pack abierto",
    defaultWeekId: pack.weekId,
    eventsBaseDirAbs,
    eventsFailedDirAbs,
    eventsPendingDirAbs,
    eventsSentDirAbs,
    eventsSource: "userData",
    mame: {
      executablePath,
      pluginName: "hsl-score",
      workingDir: mameRoot,
    },
    pack,
    packErrors: [],
    packLoaded: true,
    packPath: pack.packPath,
    packRoot,
    sessionFile: "userData/session.json",
    sessionFileAbs: path.join(userDataDir, "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    userDataDir,
    webBaseUrl: "https://high-score-league.example",
  };
}

async function createZipFromDir(sourceDir, zipPath, prefix = "") {
  const fs = require("node:fs");
  const yazl = require("yazl");
  const zip = new yazl.ZipFile();

  async function addEntries(currentDir, relativeRoot = "") {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(currentDir, entry.name);
      const relativePath = path.posix.join(prefix, relativeRoot, entry.name);

      if (entry.isDirectory()) {
        zip.addEmptyDirectory(relativePath);
        await addEntries(sourcePath, path.posix.join(relativeRoot, entry.name));
      } else {
        zip.addFile(sourcePath, relativePath);
      }
    }
  }

  await addEntries(sourceDir);

  await new Promise((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
}

function autoSyncContext(overrides = {}) {
  return {
    config: {
      eventsPendingDirAbs: "C:/pack/events/pending",
    },
    membership: {
      canSubmit: true,
      status: "member",
    },
    queue: {
      totals: {
        failed: 0,
        pending: 1,
        sent: 0,
      },
    },
    scoped: {
      scope: {
        packKey: "pack",
        playerKey: "player",
        scopedQueueRoot: "C:/userData/players/player/packs/pack",
      },
    },
    session: {
      hasSession: true,
    },
    ...overrides,
  };
}

function autoSyncQueue(totals) {
  return {
    totals: {
      failed: totals.failed || 0,
      pending: totals.pending || 0,
      sent: totals.sent || 0,
    },
  };
}

test("summarizeDiagnoseReport keeps counts without exposing raw tokens", () => {
  const report = {
    errors: [{ level: "ERROR", message: "missing dir" }],
    recommendations: ["fix config", "fix config"],
    sections: {
      config: [
        { level: "OK", message: "config cargado", detail: null },
        { level: "WARN", message: "supabaseAnonKey configurado", detail: null },
      ],
      session: [
        { level: "OK", message: "sesion local encontrada", detail: "C:/session.json" },
      ],
    },
    warnings: [{ level: "WARN", message: "warning" }],
  };

  const summary = summarizeDiagnoseReport(report);

  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.recommendationCount, 1);
  assert.deepEqual(summary.sections[0].counts, { OK: 1, WARN: 1 });
  assert.equal(JSON.stringify(summary).includes("access_token"), false);
});

test("runDiagnose writes a persistent report under userData diagnostics", async () => {
  await withTempDir(async (dir) => {
    const config = await createDiagnoseGuiConfig(dir);
    delete config.supabaseAnonKey;
    delete config.supabaseUrl;
    const libraryRoot = path.join(dir, "library");
    await writeValidPack(libraryRoot);
    await setPackDirectory(config, libraryRoot, {
      updatedAt: "2026-07-03T21:14:22.000Z",
    });

    const result = await runDiagnose({
      config,
      diagnosticLogOptions: {
        now: "2026-07-03T21:14:22.123Z",
      },
    });

    assert.equal(result.action, "diagnose");
    assert.equal(result.diagnosticLogWarning, null);
    assert.ok(result.diagnosticLog.filePath.startsWith(path.join(config.userDataDir, "diagnostics")));
    assert.equal(result.diagnosticLog.filePath.startsWith(path.join(__dirname, "..")), false);
    assert.match(result.diagnosticLog.filename, /^diagnose-2026-07-03T211422123Z\.json$/);
    assert.ok(result.lines.some((line) => /Informe guardado en diagnostics/.test(line)));

    const raw = await fsp.readFile(result.diagnosticLog.filePath, "utf8");
    const saved = JSON.parse(raw);

    assert.equal(saved.launcherVersion, "0.1.0-test");
    assert.equal(saved.paths.userDataDir, config.userDataDir);
    assert.equal(saved.paths.diagnosticsDir, path.join(config.userDataDir, "diagnostics"));
    assert.equal(saved.pack.packId, "space-invaders-week-1");
    assert.equal(saved.pack.gameId, "space-invaders");
    assert.equal(saved.pack.rom, "invaders");
    assert.equal(saved.library.totals.packs, 1);
    assert.equal(saved.queue.totals.pending, 0);
    assert.equal(saved.session.hasSession, false);
    assert.equal(saved.diagnose.counts.errors, result.report.errorCount);
    assert.ok(Array.isArray(saved.diagnose.errors));
    assert.ok(Array.isArray(saved.diagnose.warnings));
    assert.ok(Array.isArray(saved.diagnose.recommendations));
    assert.equal(/access_token|refresh_token|Authorization|secret-access-token|secret-refresh-token/.test(raw), false);
  });
});

test("runDiagnose reports diagnostic log write failures without failing diagnose", async () => {
  await withTempDir(async (dir) => {
    const config = await createDiagnoseGuiConfig(dir);
    const result = await runDiagnose({
      config,
      diagnosticLogOptions: {
        writeFileImpl: async () => {
          throw new Error("disk full");
        },
      },
      includeState: false,
    });

    assert.equal(result.action, "diagnose");
    assert.equal(result.diagnosticLog, null);
    assert.match(result.diagnosticLogWarning, /disk full/);
    assert.ok(result.lines.some((line) => /No se pudo guardar el informe de diagnostico/.test(line)));
    assert.ok(result.report);
  });
});

test("launcher service exposes manual membership recheck action", () => {
  assert.equal(typeof recheckSeasonMembership, "function");
});

test("runAutoSyncIfEligible submits eligible scoped pending queue", async () => {
  resetAutoSyncStateForTests();
  const context = autoSyncContext();
  const calls = [];

  const result = await runAutoSyncIfEligible(context, {
    getQueueStateImpl: async () => autoSyncQueue({ pending: 0, sent: 1 }),
    now: "2026-06-20T00:00:00.000Z",
    submitAllImpl: async (config) => {
      calls.push(config);
      console.log("submitted");
      return 0;
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  assert.equal(result.autoSync.status, "synced");
  assert.equal(result.autoSync.pendingBefore, 1);
  assert.equal(result.autoSync.pendingAfter, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], context.config);
  assert.deepEqual(result.lines, ["submitted"]);
});

test("runAutoSyncIfEligible skips unsafe membership states", async () => {
  resetAutoSyncStateForTests();
  let calls = 0;

  for (const status of ["not_member", "unknown", "error", "unauthenticated", "missing_week", "invalid_week"]) {
    const result = await runAutoSyncIfEligible(autoSyncContext({
      membership: {
        canSubmit: false,
        status,
      },
    }), {
      submitAllImpl: async () => {
        calls += 1;
        return 0;
      },
    });

    assert.equal(result.attempted, false);
  }

  assert.equal(calls, 0);
});

test("runAutoSyncIfEligible locks concurrent automatic attempts", async () => {
  resetAutoSyncStateForTests();
  let submitStarted;
  let releaseSubmit;
  const started = new Promise((resolve) => {
    submitStarted = resolve;
  });
  const release = new Promise((resolve) => {
    releaseSubmit = resolve;
  });

  const first = runAutoSyncIfEligible(autoSyncContext(), {
    getQueueStateImpl: async () => autoSyncQueue({ pending: 0, sent: 1 }),
    submitAllImpl: async () => {
      submitStarted();
      await release;
      return 0;
    },
  });

  await started;

  const second = await runAutoSyncIfEligible(autoSyncContext(), {
    submitAllImpl: async () => {
      throw new Error("second submit should not run");
    },
  });

  releaseSubmit();
  const firstResult = await first;

  assert.equal(second.attempted, false);
  assert.equal(firstResult.attempted, true);
  assert.equal(firstResult.autoSync.status, "synced");
});

test("runAutoSyncIfEligible reports partial failed queue after submit", async () => {
  resetAutoSyncStateForTests();

  const result = await runAutoSyncIfEligible(autoSyncContext({
    queue: autoSyncQueue({ pending: 2, sent: 0 }),
  }), {
    getQueueStateImpl: async () => autoSyncQueue({ failed: 1, pending: 0, sent: 1 }),
    submitAllImpl: async () => 1,
  });

  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.equal(result.autoSync.status, "partial_failed");
  assert.equal(result.autoSync.failedCount, 1);
});

test("launcher service wires auto-sync to safe GUI state transitions", async () => {
  const service = await fsp.readFile(
    path.join(__dirname, "..", "gui", "launcher-service.js"),
    "utf8",
  );

  assert.match(service, /getLauncherState\(options = \{\}\)/);
  assert.match(service, /runAutoSyncIfEligible\(context\)/);
  assert.match(service, /getLauncherState\(\{ attemptAutoSync: result\.ok \}\)/);
  assert.match(service, /getLauncherState\(\{ attemptAutoSync: true \}\)/);
  assert.match(service, /Puntuacion guardada localmente\. Se sincronizara cuando pueda comprobarse la temporada\./);
  assert.match(service, /autoSyncInProgress \|\| manualSyncInProgress/);
  assert.match(service, /submitAll\(scoped\.config\)/);
});

test("launcher service prepares isolated plugin run for v2 competition", async () => {
  const service = await fsp.readFile(
    path.join(__dirname, "..", "gui", "launcher-service.js"),
    "utf8",
  );

  assert.match(service, /prepareV2CompetitionRun/);
  assert.match(service, /preparedRun\.stagingPendingDir/);
  assert.match(service, /launchMameDetailed\(launchConfig/);
  assert.match(service, /Salida MAME relevante/);
  assert.equal(/Competicion v2 bloqueada: falta cargar el plugin/.test(service), false);
});

test("renderer maps membership statuses and manual recheck action", async () => {
  const gamePanel = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "game-panel.js"),
    "utf8",
  );
  const devTools = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"),
    "utf8",
  );
  const app = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "app.js"),
    "utf8",
  );

  assert.match(gamePanel, /membership\.status === "no_session"/);
  assert.match(gamePanel, /membership\.status === "unauthenticated"/);
  assert.equal(/"Sin cuenta"/.test(gamePanel), false);
  assert.match(gamePanel, /error: \["badge-warn", "Listo con avisos"\]/);
  assert.equal(/data-action="check-membership"/.test(gamePanel), false);
  assert.match(devTools, /data-action="check-membership"/);
  assert.match(gamePanel, /autoSyncBadge/);
  assert.match(gamePanel, /Auto-sync activo/);
  assert.match(app, /window\.hslLauncher\.checkMembership\(\)/);
});

test("renderer technical details include safe membership diagnostics", async () => {
  const devTools = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"),
    "utf8",
  );

  assert.match(devTools, /URL consultada/);
  assert.match(devTools, /HTTP status/);
  assert.match(devTools, /Body status/);
  assert.match(devTools, /Motivo técnico/);
  assert.match(devTools, /Auto-sync estado/);
  assert.match(devTools, /Auto-sync motivo/);
  assert.match(devTools, /Directorio de packs/);
  assert.match(devTools, /Directorio existe/);
  assert.match(devTools, /Locations legacy detectadas/);
  assert.match(devTools, /Migración legacy/);
  assert.match(devTools, /Biblioteca packs/);
  assert.match(devTools, /Biblioteca packs inválidos/);
  assert.match(devTools, /Biblioteca warnings/);
  assert.match(devTools, /Runtime MAME compartido/);
  assert.match(devTools, /data-action="choose-shared-mame-runtime"/);
  assert.match(devTools, /data-action="open-shared-mame-runtime"/);
  assert.equal(/access_token|refresh_token|Authorization|session\.json/.test(devTools), false);
});

test("renderer pack library renders seasons, views, filters and empty states", async () => {
  const libraryPanel = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "library-panel.js"),
    "utf8",
  );
  const emptyState = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "library-empty-state.js"),
    "utf8",
  );
  const packCard = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "pack-card.js"),
    "utf8",
  );
  const styles = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"),
    "utf8",
  );
  const app = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "app.js"),
    "utf8",
  );
  const devTools = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"),
    "utf8",
  );

  assert.match(libraryPanel, /library-open-control/);
  assert.match(libraryPanel, /library-open-label">Biblioteca<\/span>/);
  assert.match(libraryPanel, /library-count-pill/);
  assert.match(libraryPanel, /renderLibraryCount/);
  assert.match(libraryPanel, /1 \? "pack" : "packs"/);
  assert.match(libraryPanel, /Todavía no has elegido un directorio de packs/);
  assert.match(libraryPanel, /No se han encontrado packs en este directorio/);
  assert.match(libraryPanel, /Sin temporada/);
  assert.equal(/const id = pack\.deprecated/.test(libraryPanel), false);
  assert.match(libraryPanel, /data-action="toggle-library-filters"/);
  assert.equal(/data-action="import-pack-zip"|data-action="import-pack-folder"/.test(libraryPanel), false);
  assert.equal(/Importar ZIP|Importar carpeta/.test(libraryPanel), false);
  assert.match(libraryPanel, /data-action="choose-pack-directory"[\s\S]*data-action="toggle-library-filters"/);
  assert.match(libraryPanel, /class="library-open-control"[\s\S]*data-action="open-pack-directory"[\s\S]*library-open-label">Biblioteca<\/span>[\s\S]*data-action="rescan-pack-directory"/);
  assert.match(libraryPanel, /renderIcon\("library"/);
  assert.match(libraryPanel, /renderIcon\("refresh"/);
  assert.match(libraryPanel, /library-refresh-button/);
  assert.match(libraryPanel, /library-heading-button--spinning/);
  assert.equal(/<span>Reescanear<\/span>|<span>Abrir carpeta<\/span>/.test(libraryPanel), false);
  assert.match(libraryPanel, /aria-expanded="\$\{filtersOpen \? "true" : "false"\}"/);
  assert.match(libraryPanel, /aria-controls="library-filter-card"/);
  assert.match(libraryPanel, /filtersOpen \? "library-filter-toggle--open" : ""/);
  assert.match(libraryPanel, /Filtros/);
  assert.match(libraryPanel, /Añadir ubicación/);
  assert.match(libraryPanel, /Cambiar ubicación/);
  assert.match(libraryPanel, /renderIcon\("folder"/);
  assert.match(libraryPanel, /renderIcon\("filter"/);
  assert.match(libraryPanel, /data-library-search/);
  assert.match(libraryPanel, /placeholder="Escribe aquí\.\.\."/);
  assert.match(libraryPanel, /Búsqueda general/);
  assert.match(libraryPanel, /data-library-season/);
  assert.match(libraryPanel, /Temporada/);
  assert.match(libraryPanel, /ORDENAR/);
  assert.match(libraryPanel, /data-library-sort-by/);
  assert.equal(/data-library-sort-direction/.test(libraryPanel), false);
  assert.match(libraryPanel, /data-action="toggle-library-sort-direction"/);
  assert.match(libraryPanel, /data-direction="\$\{nextDirection\}"/);
  assert.match(libraryPanel, /renderIcon\(icon, \{ className: "library-sort-direction-icon"/);
  assert.match(libraryPanel, /data-action="toggle-library-favorite-filter"/);
  assert.match(libraryPanel, /library-favorite-filter-button/);
  assert.match(libraryPanel, /const icon = active \? "star-filled" : "star-empty"/);
  assert.match(libraryPanel, /favoriteFilterActive/);
  assert.match(libraryPanel, /libraryFavoriteFilter === "favorites"/);
  assert.match(libraryPanel, /Boolean\(pack\.favorite\)/);
  assert.match(libraryPanel, /No hay favoritos todavía/);
  assert.match(libraryPanel, /Marca algún pack como favorito/);
  assert.match(libraryPanel, /class="library-filter-field"/);
  assert.match(libraryPanel, /aria-labelledby="library-search-label"/);
  assert.match(libraryPanel, /aria-labelledby="library-season-label"/);
  assert.equal(/<label class="library-search"|<label>\s*<span>Temporada/.test(libraryPanel), false);
  assert.match(libraryPanel, /"arrow-down"/);
  assert.match(libraryPanel, /"arrow-up"/);
  assert.match(libraryPanel, /aria-label="\$\{label\}"/);
  assert.match(libraryPanel, /title="\$\{label\}"/);
  assert.match(libraryPanel, /Semanas/);
  assert.match(libraryPanel, /Alfabético/);
  assert.match(libraryPanel, /Desarrollador/);
  assert.match(libraryPanel, /Año/);
  assert.equal(/<span>Criterio<\/span>|<span>Dirección<\/span>/.test(libraryPanel), false);
  assert.equal(/<select data-library-sort-direction/.test(libraryPanel), false);
  assert.match(libraryPanel, /normalizeSortBy\(state\.librarySortBy\)/);
  assert.match(libraryPanel, /normalizeSortDirection\(state\.librarySortDirection\)/);
  assert.match(libraryPanel, /if \(!state\.libraryFiltersOpen \|\| libraryUnavailable\(state\)\)/);
  assert.equal(/data-library-status|<span>Estado<\/span>/.test(libraryPanel), false);
  assert.match(libraryPanel, /renderViewButton\(state, "covers", "Portadas", "covers"\)/);
  assert.match(libraryPanel, /renderViewButton\(state, "list", "Lista", "list"\)/);
  assert.match(libraryPanel, /renderViewButton\(state, "icons", "Iconos", "icons"\)/);
  assert.match(libraryPanel, /aria-label="\$\{label\}"/);
  assert.match(libraryPanel, /title="\$\{label\}"/);
  assert.match(libraryPanel, /library-view-button__icon/);
  assert.match(libraryPanel, /library-view-button__label/);
  assert.equal(/Vista de logos|Vista de portadas|Vista de lista|Vista de iconos/.test(libraryPanel), false);
  assert.match(libraryPanel, /pack\.developer/);
  assert.match(libraryPanel, /pack\.publisher/);
  assert.match(libraryPanel, /pack\.year/);
  assert.match(libraryPanel, /pack\.genre/);
  assert.match(libraryPanel, /pack\.rom/);
  assert.match(libraryPanel, /data-action="choose-pack-directory"/);
  assert.match(devTools, /data-action="import-pack"/);
  assert.match(devTools, /Importar pack/);
  assert.doesNotMatch(devTools, /renderIcon\("import"/);
  assert.match(app, /activeDialog: \{ type: "import-pack" \}/);
  assert.match(app, /window\.hslLauncher\.importPackZip\(\)/);
  assert.match(app, /window\.hslLauncher\.importPackFolder\(\)/);
  assert.match(app, /window\.hslLauncher\.onBusyPhase/);
  assert.match(app, /Eligiendo ZIP/);
  assert.match(app, /Eligiendo carpeta/);
  assert.match(app, /runningLabel: "Competición en curso"/);
  assert.match(app, /closingLabel: "Cerrando competición"/);
  assert.match(app, /runningLabel: "Práctica en curso"/);
  assert.match(app, /closingLabel: "Cerrando práctica"/);
  assert.match(app, /"import-pack"/);
  assert.match(libraryPanel, /data-action="open-pack-directory"/);
  assert.match(libraryPanel, /data-action="rescan-pack-directory"/);
  assert.equal(/Gestionar biblioteca|<summary>/.test(libraryPanel), false);
  assert.equal(/Juegos instalados|Temporadas y packs disponibles|juegos instalados/.test(libraryPanel), false);
  assert.match(libraryPanel, /renderPackCard\(pack, state, state\.libraryView\)/);
  assert.match(libraryPanel, /const sorted = sortPacks\(filtered, state\)/);
  assert.match(libraryPanel, /function normalizedYear\(pack\)/);
  assert.match(libraryPanel, /function primaryDeveloper\(pack\)/);
  assert.match(libraryPanel, /function shouldGroupPacks\(sortBy\)/);
  assert.match(libraryPanel, /if \(!shouldGroupPacks\(sortBy\)\)/);
  assert.match(libraryPanel, /groupPacks\(sorted, sortBy\)/);
  assert.match(libraryPanel, /sortBy === "developer"/);
  assert.match(libraryPanel, /sortBy === "year"/);
  assert.equal(/Anadir ubicacion|Ubicaciones/.test(libraryPanel), false);
  assert.equal(/Añadir pack|Anadir pack/.test(libraryPanel), false);
  assert.match(emptyState, /library-empty-state/);
  assert.match(packCard, /if \(view === "covers"\) return pack\.cover \|\| pack\.icon/);
  assert.match(packCard, /return pack\.icon \|\| pack\.cover/);
  assert.equal(/pack\.logo/.test(packCard), false);
  assert.match(packCard, /pack-card__placeholder/);
  assert.match(packCard, /statusMeta/);
  assert.match(packCard, /REQUIERE ATENCION/);
  assert.match(packCard, /LEGACY/);
  assert.match(packCard, /LISTO/);
  assert.match(packCard, /week-status-badge/);
  assert.match(packCard, /week-status--ready/);
  assert.equal(/ABIERTO/.test(packCard), false);
  assert.equal(/Seleccionar|library-use-button|Ya activo/.test(packCard), false);
  assert.match(packCard, /data-action="use-library-pack"/);
  assert.match(packCard, /data-action="toggle-library-favorite"/);
  assert.match(packCard, /data-pack-key/);
  assert.match(packCard, /Inicia sesión para marcar favoritos/);
  assert.match(packCard, /favorite-slot--locked/);
  assert.equal(/favoritePending/.test(packCard), false);
  assert.equal(/favorite-slot--pending/.test(packCard), false);
  assert.equal(/Guardando favorito/.test(packCard), false);
  assert.match(packCard, /pack\.favoriteDisabled/);
  assert.match(packCard, /pack\.duplicatePackId/);
  assert.equal(/const disabled = [^;]*pack\.status === "error"/.test(packCard), false);
  assert.match(packCard, /pack\.status === "missing"/);
  assert.match(packCard, /if \(activeRoot\) \{\s*return false;\s*\}/);
  assert.match(packCard, /Boolean\(state\.data\?\.session\?\.hasSession\)/);
  assert.match(packCard, /pendingLibraryPackId/);
  assert.match(packCard, /libraryActivationInProgress/);
  assert.match(packCard, /pack-card--pending/);
  assert.match(packCard, /aria-busy="true"/);
  assert.match(packCard, /renderIcon\(favorite \? "star-filled" : "star-empty"/);
  assert.match(packCard, /renderIcon\("calendar"/);
  assert.equal(/renderIcon\(meta\.icon|Con errores|Instalado|pack-card__legacy|statusTone/.test(packCard), false);
  assert.match(packCard, /favorite-slot/);
  assert.match(packCard, /favorite-slot--active/);
  assert.match(styles, /\.library-pack-grid/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-CARDS-1/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-CONTROLS-REVAMP-2/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-RESPONSIVE-AUTH-GUARDS-4/);
  assert.match(styles, /\.library-panel[\s\S]*container-type: inline-size/);
  assert.match(styles, /\.library-title-row/);
  assert.match(styles, /\.pack-card--icons \.pack-card__status--dot[\s\S]*background: transparent/);
  assert.match(styles, /\.pack-card--icons \.pack-card__status--dot[\s\S]*box-shadow: none/);
  assert.match(styles, /\.favorite-slot--pending/);
  assert.match(styles, /\.favorite-slot--pending[\s\S]*opacity: 1[\s\S]*filter: none[\s\S]*cursor: pointer/);
  assert.match(styles, /\.pack-error-panel/);
  assert.match(styles, /\.library-count-pill/);
  assert.match(styles, /\.library-panel[\s\S]*gap: 8px/);
  assert.match(styles, /\.library-panel > \.panel-heading[\s\S]*margin-bottom: 0/);
  assert.match(styles, /\.library-control-row--primary[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.library-filter-card/);
  assert.match(styles, /\.library-filter-card[\s\S]*padding: 8px/);
  assert.match(styles, /\.library-search input,\s*\n\.library-filters select,\s*\n\.library-sort select,\s*\n\.library-sort-direction-button,\s*\n\.library-favorite-filter-button[\s\S]*min-height: 35px/);
  assert.match(styles, /\.library-control-button,\s*\n\.view-button[\s\S]*min-height: 35px/);
  assert.match(styles, /\.library-control-button,\s*\n\.view-button[\s\S]*align-items: center/);
  assert.match(styles, /\.library-control-button span[\s\S]*align-items: center/);
  assert.match(styles, /\.library-control-button,\s*\n\.view-button[\s\S]*font-size: 12\.5px/);
  assert.match(styles, /\.library-control-button[\s\S]*gap: 7px/);
  assert.match(styles, /\.library-open-control[\s\S]*border: 0[\s\S]*background: transparent[\s\S]*cursor: pointer/);
  assert.match(styles, /\.library-open-control:hover:not\(:disabled\)[\s\S]*background: transparent[\s\S]*color: var\(--text\)/);
  assert.match(styles, /\.library-open-control:focus-visible[\s\S]*outline/);
  assert.match(styles, /\.library-refresh-button[\s\S]*width: 28px[\s\S]*height: 28px/);
  assert.match(styles, /\.library-refresh-icon\.ui-icon[\s\S]*width: 14px[\s\S]*height: 14px/);
  assert.match(styles, /\.library-heading-button:hover:not\(:disabled\)[\s\S]*var\(--circuit\)/);
  assert.match(styles, /\.library-heading-button:focus-visible[\s\S]*outline/);
  assert.match(styles, /\.library-sort__controls[\s\S]*grid-template-columns: minmax\(0, 1fr\) 42px 42px/);
  assert.match(styles, /\.library-sort-direction-button,\s*\n\.library-favorite-filter-button[\s\S]*width: 42px/);
  assert.match(styles, /\.library-favorite-filter-button--active[\s\S]*var\(--circuit\)/);
  assert.match(styles, /\.library-favorite-filter-button \.library-favorite-filter-icon\.ui-icon,\s*\n\.library-favorite-filter-button--active \.library-favorite-filter-icon\.ui-icon[\s\S]*color: currentColor/);
  assert.match(styles, /\.library-favorite-filter-button[\s\S]*color: var\(--text-muted\)/);
  assert.match(styles, /\.library-favorite-filter-button--active[\s\S]*background: color-mix\(in srgb, var\(--circuit\) 18%, var\(--surface\)\)[\s\S]*color: var\(--circuit\)/);
  assert.match(styles, /\.library-favorite-filter-button--active \.library-favorite-filter-icon\.ui-icon,[\s\S]*\.library-favorite-filter-button--active \.library-favorite-filter-icon\.ui-icon \.ui-icon__glyph[\s\S]*background-color: currentColor/);
  assert.match(styles, /\.library-favorite-filter-button \.library-favorite-filter-icon\.ui-icon \.ui-icon__glyph[\s\S]*-webkit-mask-size: contain[\s\S]*mask-size: contain/);
  assert.match(styles, /\.library-sort-direction-icon\.ui-icon,\s*\n\.library-favorite-filter-icon\.ui-icon,\s*\n\.library-control-icon\.ui-icon[\s\S]*align-self: center[\s\S]*color: currentColor/);
  assert.match(styles, /\.library-filters select option,\s*\n\.library-sort select option[\s\S]*background: var\(--surface\)/);
  assert.match(styles, /\.library-filters select option:hover,\s*\n\.library-sort select option:hover[\s\S]*var\(--circuit\)/);
  assert.equal(/option:checked[\s\S]{0,120}var\(--circuit\)/.test(styles), false);
  assert.match(styles, /\.library-scroll[\s\S]*overflow: hidden/);
  assert.match(styles, /\.library-section--packs[\s\S]*overflow-y: scroll/);
  assert.equal(/\.library-section--packs::after|\.library-scroll::after|library-scrollbar-thumb/.test(styles), false);
  assert.match(styles, /\.library-section--packs[\s\S]*align-content: start/);
  assert.match(styles, /\.library-section--packs[\s\S]*padding-right: 10px/);
  assert.match(styles, /\.library-section--packs[\s\S]*scrollbar-gutter: stable/);
  assert.match(styles, /\.season-group[\s\S]*align-content: start/);
  assert.match(styles, /\.library-pack-grid[\s\S]*align-content: start/);
  assert.match(styles, /:root\[data-theme="dark"\] \*[\s\S]*scrollbar-color:[\s\S]*var\(--circuit\)/);
  assert.match(styles, /:root\[data-theme="dark"\] \*::-webkit-scrollbar-thumb[\s\S]*var\(--circuit\)/);
  assert.equal(/:root:not\(\[data-theme="dark"\]\)|data-theme="light"[\s\S]*scrollbar/.test(styles), false);
  assert.match(styles, /\.library-control-button\[data-action="toggle-library-filters"\][\s\S]*background: var\(--surface-muted\)/);
  assert.match(styles, /\.library-control-button\.library-filter-toggle--open[\s\S]*var\(--circuit\)/);
  assert.match(styles, /\.library-pack-grid--covers[\s\S]*repeat\(auto-fit, minmax\(156px, 178px\)\)/);
  assert.match(styles, /\.library-pack-grid--covers[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@container \(max-width: 340px\)[\s\S]*\.library-pack-grid--covers[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@container \(max-width: 340px\)[\s\S]*\.library-view-button__label/);
  assert.match(styles, /@container \(max-width: 340px\)[\s\S]*\.library-view-button__icon[\s\S]*display: inline-grid/);
  assert.match(styles, /\.library-pack-grid--list/);
  assert.match(styles, /\.pack-card--list[\s\S]*min-height: 54px/);
  assert.match(styles, /\.pack-card--list[\s\S]*padding: 6px 8px 6px 50px/);
  assert.match(styles, /\.pack-card--list \.pack-card__media[\s\S]*aspect-ratio: 1 \/ 1/);
  assert.match(styles, /\.pack-card--list \.pack-card__media[\s\S]*overflow: hidden/);
  assert.match(styles, /\.pack-card--list \.pack-card__media[\s\S]*border-radius: 8px/);
  assert.match(styles, /\.pack-card--list \.pack-card__media[\s\S]*background: var\(--surface-muted\)/);
  assert.match(styles, /\.pack-card--list \.pack-card__media img[\s\S]*object-fit: cover/);
  assert.match(styles, /\.pack-card--pending/);
  assert.match(styles, /\.pack-card--pending[\s\S]*border-color: var\(--border\)[\s\S]*filter: brightness\(0\.96\)/);
  assert.match(styles, /\.pack-card--pending\.pack-card--active[\s\S]*var\(--circuit\)/);
  assert.match(styles, /\.pack-card\[role="button"\]:focus-visible[\s\S]*outline/);
  assert.match(styles, /\.library-pack-grid--icons/);
  assert.match(styles, /LOCAL-LIBRARY-ICON-VIEW-UNIFORM-SIZE-2/);
  assert.match(styles, /--library-icon-tile-min: 122px/);
  assert.match(styles, /\.library-pack-grid--icons[\s\S]*gap: 12px 8px/);
  assert.equal(/--library-icon-tile-min: 84px|--library-icon-tile-min: 96px|--library-icon-tile-min: 112px/.test(styles), false);
  assert.match(styles, /\.library-pack-grid--icons[\s\S]*repeat\(auto-fill, minmax\(var\(--library-icon-tile-min\), 1fr\)\)/);
  assert.equal(/LOCAL-LIBRARY-ICON-VIEW-UNIFORM-SIZE-2[\s\S]*repeat\(auto-fit, minmax\(var\(--library-icon-tile-min\), 1fr\)\)/.test(styles), false);
  assert.match(styles, /\.library-pack-grid--icons[\s\S]*justify-content: stretch/);
  assert.match(styles, /\.pack-card--icons[\s\S]*width: 100%/);
  assert.match(styles, /\.pack-card--icons \.pack-card__media[\s\S]*width: 100%[\s\S]*aspect-ratio: 1 \/ 1/);
  assert.match(styles, /\.week-status-badge[\s\S]*border-color: currentColor/);
  assert.match(styles, /\.week-status-badge\.week-status--open[\s\S]*color: var\(--ok\)/);
  assert.match(styles, /\.pack-card--icons \.pack-card__status \.week-status-badge[\s\S]*min-height: 20px/);
  assert.match(styles, /\.pack-card--active/);
  assert.match(styles, /\.pack-card__placeholder/);
  assert.match(styles, /\.favorite-slot/);
  assert.match(styles, /\.favorite-slot[\s\S]*place-items: center/);
  assert.match(styles, /\.favorite-slot[\s\S]*border-radius: 8px/);
  assert.match(styles, /\.pack-card--list \.favorite-slot[\s\S]*width: 28px[\s\S]*height: 28px/);
  assert.match(styles, /\.favorite-slot--active[\s\S]*var\(--circuit\)/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.favorite-slot[\s\S]*background: color-mix\(in srgb, var\(--surface\) 90%, transparent\)[\s\S]*color: color-mix\(in srgb, var\(--text-muted\) 76%, var\(--surface-strong\)\)/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.favorite-slot--active,[\s\S]*html:not\(\[data-theme="dark"\]\) \.favorite-slot:hover:not\(:disabled\)[\s\S]*color: var\(--circuit\)/);
  assert.match(styles, /\.favorite-slot--locked/);
  assert.equal(/favorite-slot--active[\s\S]{0,140}var\(--warn\)/.test(styles), false);
  assert.match(styles, /\.favorite-icon/);
  assert.match(styles, /\.library-view-icon/);
  assert.match(styles, /\.pack-card--covers \.pack-card__media[\s\S]*aspect-ratio: 2 \/ 3/);
  assert.match(styles, /\.library-pack-grid--covers[\s\S]*align-items: stretch/);
  assert.equal(/\.pack-card--covers \.pack-card__text h3[\s\S]{0,120}min-height: calc\(2 \* 1\.16em\)/.test(styles), false);
  assert.match(styles, /\.pack-card__status \.badge[\s\S]*min-height: 22px/);
  assert.match(styles, /\.pack-card__status \.badge[\s\S]*border-color: currentColor/);
  assert.match(styles, /\.week-status--open[\s\S]*var\(--ok\)/);
  assert.match(styles, /\.week-status--ending[\s\S]*#a78bfa/);
  assert.match(styles, /\.week-status--closed[\s\S]*var\(--warn\)/);
  assert.match(styles, /\.pack-card__subtitle[\s\S]*align-items: center/);
  assert.match(styles, /\.pack-card__subtitle-icon\.ui-icon[\s\S]*transform: none/);
  assert.match(styles, /\.pack-card--covers \.pack-card__subtitle-icon\.ui-icon,\s*\n\.pack-card--list \.pack-card__subtitle-icon\.ui-icon[\s\S]*width: 12px[\s\S]*height: 12px/);
  assert.match(styles, /\.view-button \.library-view-icon\.ui-icon[\s\S]*color: currentColor/);
  assert.match(styles, /\.view-button:not\(\.view-button--active\)[\s\S]*color: var\(--text-muted\)/);
  assert.match(styles, /\.view-button--active[\s\S]*color: var\(--circuit\)/);
  assert.match(styles, /\.pack-card--icons \.pack-card__media[\s\S]*aspect-ratio: 1 \/ 1/);
  assert.equal(/escapeHtml\(pack\.packDir|escapeHtml\(pack\.packPath/.test(packCard), false);
  assert.equal(/checkSeasonMembership|membership/.test(libraryPanel + packCard), false);
  assert.equal(/access_token|refresh_token|Authorization/.test(libraryPanel + packCard), false);
});

test("renderer pack library groups years and developers without changing alphabetical view", async () => {
  const { libraryPanelTestApi, renderLibraryPanel } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "library-panel.js",
  )));
  const packs = [
    {
      id: "space",
      favorite: true,
      favoriteKey: "space",
      packId: "space-pack",
      title: "Space Invaders",
      developer: "Taito \u00b7 Midway",
      publisher: "Taito",
      year: "1978",
      seasonId: "test",
      seasonName: "Temporada test",
      status: "ready",
      weekId: "week-1",
      weekNumber: 1,
    },
    {
      id: "donkey",
      favorite: false,
      favoriteKey: "donkey",
      packId: "donkey-pack",
      title: "Donkey Kong",
      developer: ["Nintendo", "Ikegami"],
      year: 1981,
      seasonId: "test",
      seasonName: "Temporada test",
      status: "ready",
      weekId: "week-2",
      weekNumber: 2,
    },
    {
      id: "pacman",
      favorite: false,
      favoriteKey: "pacman",
      packId: "pacman-pack",
      title: "Pac-Man",
      developer: "Namco, Atari",
      year: "1980",
      seasonId: "classic",
      seasonName: "Classic",
      status: "ready",
      weekId: "week-1",
      weekNumber: 1,
    },
    {
      id: "phoenix",
      favorite: false,
      favoriteKey: "phoenix",
      packId: "phoenix-pack",
      title: "Phoenix",
      developer: ["Taito", "Centuri"],
      year: "1980",
      status: "ready",
      weekId: "week-3",
      weekNumber: 3,
    },
    {
      id: "mystery",
      favorite: true,
      favoriteKey: "mystery",
      packId: "mystery-pack",
      title: "Mystery Pack",
      developer: "",
      publisher: "",
      year: "",
      status: "ready",
      weekId: "week-4",
      weekNumber: 4,
    },
  ];
  const stateFor = (overrides = {}) => ({
    busy: false,
    data: {
      bridge: {},
      library: {
        directory: {
          path: "C:/packs",
        },
        packs,
        totals: {
          packs: packs.length,
        },
      },
      session: {
        hasSession: true,
      },
    },
    libraryFavoriteFilter: "all",
    libraryFiltersOpen: false,
    libraryQuery: "",
    librarySeason: "all",
    librarySortBy: "weeks",
    librarySortDirection: "asc",
    libraryStatus: "all",
    libraryView: "covers",
    pendingLibraryPackId: null,
    ...overrides,
  });
  const compactGroups = (groups) => groups.map((group) => [group.title, group.packs.map((pack) => pack.id)]);

  assert.deepEqual(compactGroups(libraryPanelTestApi.groupPacks(
    libraryPanelTestApi.sortPacks(packs, stateFor({ librarySortBy: "weeks" })),
    "weeks",
  )), [
    ["Sin temporada", ["phoenix", "mystery"]],
    ["Classic", ["pacman"]],
    ["Temporada test", ["space", "donkey"]],
  ]);

  assert.deepEqual(compactGroups(libraryPanelTestApi.groupPacks(
    libraryPanelTestApi.sortPacks(packs, stateFor({ librarySortBy: "year" })),
    "year",
  )), [
    ["1978", ["space"]],
    ["1980", ["pacman", "phoenix"]],
    ["1981", ["donkey"]],
    ["Sin a\u00f1o", ["mystery"]],
  ]);

  const developerGroups = libraryPanelTestApi.groupPacks(
    libraryPanelTestApi.sortPacks(packs, stateFor({ librarySortBy: "developer" })),
    "developer",
  );

  assert.deepEqual(compactGroups(developerGroups), [
    ["Namco", ["pacman"]],
    ["Nintendo", ["donkey"]],
    ["Taito", ["phoenix", "space"]],
    ["Sin desarrollador", ["mystery"]],
  ]);
  assert.equal(libraryPanelTestApi.primaryDeveloper(packs[0]), "Taito");
  assert.equal(libraryPanelTestApi.primaryDeveloper(packs[1]), "Nintendo");
  assert.equal(libraryPanelTestApi.primaryDeveloper(packs[2]), "Namco");
  assert.equal(libraryPanelTestApi.primaryDeveloper(packs[4]), null);
  assert.deepEqual(developerGroups.find((group) => group.title === "Taito").packs.map((pack) => pack.id), ["phoenix", "space"]);

  assert.equal(libraryPanelTestApi.shouldGroupPacks("title"), false);
  assert.equal(/season-group__heading/.test(renderLibraryPanel(stateFor({ librarySortBy: "title" }))), false);

  const favoriteYear = renderLibraryPanel(stateFor({
    libraryFavoriteFilter: "favorites",
    librarySortBy: "year",
  }));
  assert.match(favoriteYear, /<h3>1978<\/h3>[\s\S]*<span>1 pack<\/span>/);
  assert.match(favoriteYear, /<h3>Sin a\u00f1o<\/h3>[\s\S]*<span>1 pack<\/span>/);
  assert.equal(/<h3>1980<\/h3>|<h3>1981<\/h3>/.test(favoriteYear), false);

  const searchedDeveloper = renderLibraryPanel(stateFor({
    libraryQuery: "space",
    librarySortBy: "developer",
  }));
  assert.match(searchedDeveloper, /<h3>Taito<\/h3>[\s\S]*<span>1 pack<\/span>/);
  assert.equal(/<h3>Namco<\/h3>|<h3>Nintendo<\/h3>|<h3>Sin desarrollador<\/h3>/.test(searchedDeveloper), false);

  for (const view of ["covers", "list", "icons"]) {
    const yearHtml = renderLibraryPanel(stateFor({ librarySortBy: "year", libraryView: view }));
    const developerHtml = renderLibraryPanel(stateFor({ librarySortBy: "developer", libraryView: view }));

    assert.match(yearHtml, new RegExp(`season-group[\\s\\S]*library-pack-grid--${view}`));
    assert.match(developerHtml, new RegExp(`season-group[\\s\\S]*library-pack-grid--${view}`));
  }
});

test("renderer product hierarchy includes connection, player actions, activity and advanced options", async () => {
  const [app, appDialog, busyOverlay, header, copy, gamePanel, queuePanel, devTools, styles] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "app-dialog.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "busy-overlay.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "header.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "copy.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "game-panel.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "queue-panel.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"), "utf8"),
  ]);

  assert.match(app, /app-main/);
  assert.match(app, /import \{ renderAppDialog \} from "\.\/components\/app-dialog\.js"/);
  assert.match(app, /import \{ renderBusyOverlay \} from "\.\/components\/busy-overlay\.js"/);
  assert.match(app, /renderOverlay\(state\)[\s\S]*renderAppDialog\(state\)[\s\S]*renderBusyOverlay\(state\)/);
  assert.match(app, /busy: true/);
  assert.match(app, /busyLabel: "Iniciando"/);
  assert.match(app, /busy: false,[\s\S]*busyLabel: null,[\s\S]*data,/);
  assert.match(app, /--library-sidebar-width/);
  assert.match(app, /library-resizer/);
  assert.match(app, /data-sidebar-resizer/);
  assert.match(app, /libraryFiltersOpen: false/);
  assert.match(app, /librarySortBy: "weeks"/);
  assert.match(app, /librarySortDirection: "asc"/);
  assert.match(app, /libraryFavoriteFilter: "all"/);
  assert.match(app, /action === "toggle-library-filters"/);
  assert.match(app, /store\.setState\(\{ libraryFiltersOpen: !store\.getState\(\)\.libraryFiltersOpen \}\)/);
  assert.match(app, /store\.setState\(\{ libraryQuery: input\.value \}\)/);
  assert.match(app, /store\.setState\(\{ librarySeason: target\.value \}\)/);
  assert.match(app, /target\.matches\("\[data-library-sort-by\]"\)/);
  assert.equal(/target\.matches\("\[data-library-sort-direction\]"\)/.test(app), false);
  assert.match(app, /action === "toggle-library-sort-direction"/);
  assert.match(app, /button\.dataset\.direction === "desc" \? "desc" : "asc"/);
  assert.match(app, /function persistLibraryPreferencesSoon\(patch\)/);
  assert.match(app, /libraryPreferencesPersistSequence/);
  assert.match(app, /libraryPreferenceUserRevision/);
  assert.match(app, /function libraryPreferencesStatePatch\(data, current, allowHydration = true\)/);
  assert.match(app, /function currentLibraryPreferencesPatch\(patch = \{\}\)/);
  assert.match(app, /startedWithLibraryPreferenceRevision === libraryPreferenceUserRevision/);
  assert.match(app, /persistLibraryPreferencesSoon\(\{ librarySortBy \}\)/);
  assert.match(app, /persistLibraryPreferencesSoon\(\{ librarySortDirection \}\)/);
  assert.match(app, /action === "toggle-library-favorite-filter"/);
  assert.match(app, /libraryFavoriteFilter: button\.dataset\.filter === "favorites" \? "favorites" : "all"/);
  assert.match(app, /libraryFavoriteFilter: data\.session\?\.hasSession \? current\.libraryFavoriteFilter : "all"/);
  assert.match(app, /function readMainScrollState\(\)/);
  assert.match(app, /function restoreMainScrollState\(scrollState, \{ resetGame = false \} = \{\}\)/);
  assert.match(app, /function detailScrollKeyFromState\(state\)/);
  assert.match(app, /root\.querySelector\("\.game-scroll"\)\?\.scrollTop/);
  assert.match(app, /gameScroll\.scrollTop = resetGame \? 0 : scrollState\.game/);
  assert.match(app, /currentDetailScrollKey && nextDetailScrollKey && currentDetailScrollKey !== nextDetailScrollKey/);
  assert.match(app, /restoreMainScrollState\(scrollState, \{ resetGame: resetGameScroll \}\)/);
  assert.match(app, /currentDetailScrollKey = nextDetailScrollKey/);
  assert.equal(/window\.scrollTo/.test(app), false);
  assert.match(app, /libraryScroll\.scrollTop = scrollState\.library/);
  assert.match(app, /setLibraryPreferences/);
  assert.match(app, /toggleLibraryFavorite/);
  assert.match(app, /button\.disabled \|\| !store\.getState\(\)\.data\?\.session\?\.hasSession/);
  assert.match(app, /event\.stopPropagation\(\)/);
  assert.match(app, /persistLibraryPreferencesSoon\(\{ libraryView \}\)/);
  assert.match(app, /await window\.hslLauncher\.setLibraryPreferences\(currentLibraryPreferencesPatch\(patch\)\)/);
  assert.equal(/response\.state[\s\S]{0,400}libraryView/.test(app), false);
  assert.match(app, /LIBRARY_SIDEBAR_MIN = 340/);
  assert.match(app, /LIBRARY_SIDEBAR_MAX = 600/);
  assert.match(app, /LIBRARY_SIDEBAR_DEFAULT = 440/);
  assert.match(app, /pendingFavoriteKeys: \{\}/);
  assert.match(app, /const favoriteSyncByKey = new Map\(\)/);
  assert.match(app, /function withFavoritePatch\(data, packKey, patch\)/);
  assert.match(app, /desiredFavorite: nextFavorite/);
  assert.match(app, /rollbackFavorite: existingSync\.inFlight \? existingSync\.rollbackFavorite : previousFavorite/);
  assert.match(app, /sequence: existingSync\.sequence \+ 1/);
  assert.match(app, /if \(existingSync\.inFlight\) \{\s*return;\s*\}/);
  assert.match(app, /favoritePending: true/);
  const favoriteToggleSource = app.slice(
    app.indexOf("async function toggleLibraryFavorite"),
    app.indexOf("async function syncLibraryFavorite"),
  );
  assert.equal(/busy:\s*true|busyLabel/.test(favoriteToggleSource), false);
  assert.match(app, /response\.ok === false/);
  assert.match(app, /latestSync && latestSync\.sequence !== requestSequence/);
  assert.match(app, /delete latestPending\[packKey\]/);
  assert.match(app, /favorite: favoriteBeforeRequest/);
  assert.match(app, /summary: "No se pudo actualizar el favorito\."/);
  assert.match(app, /DETAIL_ASSET_PRELOAD_TIMEOUT_MS = 600/);
  assert.match(app, /function preloadImageUrl\(url, timeoutMs = DETAIL_ASSET_PRELOAD_TIMEOUT_MS\)/);
  assert.match(app, /new Image\(\)/);
  assert.match(app, /function detailAssetUrlsFromGame\(game = \{\}\)/);
  assert.match(app, /game\.assets\?\.hero\?\.url \|\| game\.assets\?\.cover\?\.url/);
  assert.match(app, /game\.assets\?\.logo\?\.url \|\| game\.assets\?\.icon\?\.url/);
  assert.match(app, /function detailAssetUrlsFromLibraryPack\(pack = \{\}\)/);
  assert.match(app, /pack\.hero\?\.url \|\| pack\.cover\?\.url/);
  assert.match(app, /pack\.logo\?\.url \|\| pack\.icon\?\.url/);
  assert.match(app, /function preloadDetailAssetUrls\(urls\)/);
  assert.match(app, /libraryPackSelectionSequence/);
  assert.match(app, /requestId !== libraryPackSelectionSequence/);
  assert.match(app, /function activateLibraryPackWithPreload\(packId\)/);
  assert.match(app, /window\.hslLauncher\.useLibraryPack\(safePackId\)/);
  assert.equal(/runAction\(action, "Activando pack", "Usar pack de biblioteca"[\s\S]{0,120}useLibraryPack/.test(app), false);
  assert.match(app, /library-panel-region/);
  assert.match(app, /game-panel-region/);
  assert.match(app, /modal-layer/);
  assert.match(app, /renderBusyOverlay\(state\)/);
  assert.match(app, /drawer-layer/);
  assert.match(app, /data-overlay-backdrop/);
  assert.match(app, /drawer-body/);
  assert.match(app, /target\?\.matches\("\[data-overlay-backdrop\]"\)/);
  assert.match(app, /data-action="close-overlay"/);
  assert.match(app, /renderIcon\("close"/);
  assert.match(app, /aria-label="Cerrar"/);
  assert.match(app, /action === "show-activity-details"[\s\S]*!store\.getState\(\)\.data\?\.session\?\.hasSession[\s\S]*return/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /event\.key === "D" && event\.ctrlKey && event\.shiftKey/);
  assert.match(app, /!target\.closest\("\[data-account-menu\]"\)/);
  assert.match(app, /Configuracion/);
  assert.match(app, /renderLibraryPanel\(state\)[\s\S]*renderGamePanel\(state\)/);
  assert.equal(/renderQueuePanel\(state\)|advanced-entry|show-advanced-options/.test(app), false);
  assert.equal(/renderPlayerSummary/.test(app), false);
  assert.match(header, /High Score League Launcher/);
  assert.match(header, /brand-lockup/);
  assert.match(header, /app-icon-slot/);
  assert.match(header, /renderIcon\("app"/);
  assert.match(header, /renderIcon\(themeIcon/);
  assert.match(header, /state\.theme === "dark" \? "moon" : "sun"/);
  assert.match(header, /theme-button--icon/);
  assert.match(header, /aria-label="\$\{themeLabel\}"/);
  assert.equal(/<span>\$\{themeLabel\}<\/span>/.test(header), false);
  assert.match(header, /connection-dot/);
  assert.equal(/renderIcon\(connection|status-online|status-offline|status-reconnecting/.test(header), false);
  assert.equal(/<p class="eyebrow">HSL<\/p>/.test(header), false);
  assert.equal(/data-action="refresh"/.test(header), false);
  assert.match(header, /Conectado/);
  assert.match(header, /Sin Internet/);
  assert.match(header, /Reconectando/);
  assert.match(header, /icon-slot-button/);
  assert.match(header, /data-action="toggle-account-menu"/);
  assert.match(header, /<strong>Cuentas<\/strong>/);
  assert.match(header, /data-action="switch-account"/);
  assert.equal(/data-action="logout"/.test(header), false);
  assert.match(header, /account-row__check/);
  assert.match(header, /icon-slot--check/);
  assert.match(header, /renderIcon\("user"/);
  assert.match(header, /renderIcon\("check"/);
  assert.match(header, /renderIcon\("add"/);
  assert.equal(/renderIcon\("logout"/.test(header), false);
  assert.match(header, /renderIcon\("forget-account"/);
  assert.match(header, /renderIcon\("email"/);
  assert.match(header, /renderIcon\("password"/);
  assert.match(header, /account-forget-button/);
  assert.match(header, /No has iniciado sesión/);
  assert.match(header, /account-mini-avatar--empty/);
  assert.match(copy, /launcherSubtitle: "Tu compañero para jugar la liga\."/);
  assert.equal(/Cambio rápido disponible|Cambio rÃ¡pido disponible|Cuenta activa|badge badge-ok|No se guardan contrase|Las puntuaciones se guardan|No borra puntuaciones/.test(header), false);
  assert.match(gamePanel, /data-action="play"/);
  assert.match(gamePanel, /data-action="practice"/);
  assert.match(gamePanel, /renderContentAction\("open-manual", "Manual"/);
  assert.match(gamePanel, /renderContentAction\("open-ranking", "Ranking"/);
  assert.match(gamePanel, /game-detail-card/);
  assert.match(gamePanel, /game-hero-stage/);
  assert.match(gamePanel, /game-hero-stage--with-logo/);
  assert.match(gamePanel, /game-hero-media/);
  assert.match(gamePanel, /renderHeroLogo/);
  assert.match(gamePanel, /game-hero__logo/);
  assert.match(gamePanel, /game-detail-body/);
  assert.match(gamePanel, /game-metadata-grid/);
  assert.match(gamePanel, /aria-label="Metadatos del juego"/);
  assert.match(gamePanel, /game-metadata-item--\$\{escapeHtml\(area\)\}/);
  assert.match(gamePanel, /game-metadata-label/);
  assert.match(gamePanel, /game-metadata-label sr-only/);
  assert.match(gamePanel, /game-metadata-value/);
  assert.match(gamePanel, /aria-label="\$\{escapeHtml\(label\)\}: \$\{escapeHtml\(value\)\}"/);
  assert.match(gamePanel, /normalizeMetadataValue/);
  assert.match(gamePanel, /split\(splitCommas \?/);
  assert.match(gamePanel, /\[·,;\]/);
  assert.match(gamePanel, /parts\.join\(" · "\)/);
  assert.equal(/pack-metadata-grid|pack-metadata-item|meta-label|meta-value/.test(gamePanel), false);
  assert.match(gamePanel, /ready-copy[\s\S]*renderPackMetadata\(game\)/);
  assert.equal(/const subtitle = game\?\.subtitle|class="game-week"/.test(gamePanel), false);
  assert.match(gamePanel, /renderIcon\(icon, \{ className: "game-metadata-icon" \}/);
  assert.match(gamePanel, /"developer", "developer", "Desarrollador"/);
  assert.match(gamePanel, /"year", "year", "Año"/);
  assert.match(gamePanel, /"genre", "genre", "Género"/);
  assert.match(gamePanel, /"playtime", "playtime", "Tiempo jugado"/);
  assert.equal(/"Empresa"|"Tiempo"/.test(gamePanel), false);
  assert.match(gamePanel, /"Sin datos"/);
  assert.match(gamePanel, /renderIcon\("calendar"/);
  assert.match(gamePanel, /renderIcon\("play"/);
  assert.match(gamePanel, /renderIcon\("practice"/);
  assert.match(gamePanel, /<h2 title="\$\{escapeHtml\(game\?\.displayName \|\| "Space Invaders"\)\}"/);
  assert.match(gamePanel, /function renderDetailFavoriteMark\(game\)/);
  assert.match(gamePanel, /game-title-main/);
  assert.match(gamePanel, /game-week-subtitle/);
  assert.match(gamePanel, /game-favorite-mark/);
  assert.match(gamePanel, /if \(!favorite\) \{\s*return "";\s*\}/);
  assert.match(gamePanel, /renderIcon\("star-filled"/);
  assert.equal(/star-empty/.test(gamePanel), false);
  assert.match(gamePanel, /role="img" aria-label="Juego favorito"/);
  assert.equal(/<button[^>]*game-favorite-mark/.test(gamePanel), false);
  assert.equal(/game-favorite-chip|>Favorito</.test(gamePanel), false);
  assert.equal(/badge badge-muted week-chip/.test(gamePanel), false);
  assert.match(gamePanel, /"manual"/);
  assert.match(gamePanel, /renderStatusBadges/);
  assert.match(gamePanel, /function renderPackErrors\(game, readiness\)/);
  assert.match(gamePanel, /Pack duplicado/);
  assert.match(gamePanel, /Este pack tiene errores/);
  assert.match(gamePanel, /duplicatePaths/);
  assert.match(gamePanel, /pack-error-paths/);
  assert.match(gamePanel, /renderPackErrors\(game, readiness\)/);
  assert.match(gamePanel, /\.slice\(0, 4\)/);
  assert.match(gamePanel, /action-button-label/);
  assert.match(gamePanel, /action-grid/);
  assert.match(gamePanel, /renderActivitySummaryCard\(state\)/);
  assert.match(gamePanel, /Pack listo/);
  assert.match(gamePanel, /Participas en la temporada/);
  assert.match(gamePanel, /Auto-sync activo/);
  assert.equal(/function renderPackLogo|class="pack-logo"|pack-title-row[\s\S]{0,220}renderHeroLogo/.test(gamePanel), false);
  assert.equal(/getReadyLabel|Competicion|Pack abierto|Ultimo pack cargado|Cola cuenta \+ pack|Pack abierto correctamente|Listo para competir|Sincronizacion automatica lista|data-action="check-membership"/.test(gamePanel), false);
  assert.equal(/game-panel__score/.test(gamePanel), false);
  assert.match(queuePanel, /Actividad local/);
  assert.match(queuePanel, /Inicia sesión para ver tu actividad local/);
  assert.match(queuePanel, /activity-summary-card--locked/);
  assert.match(queuePanel, /activity-panel--locked/);
  assert.match(queuePanel, /data-action="show-activity-details"/);
  assert.match(queuePanel, /getActivitySummary/);
  assert.equal(/activity-summary-card__label/.test(queuePanel), false);
  assert.equal(/activity-summary-card__copy[\s\S]{0,90}Actividad local/.test(queuePanel), false);
  assert.match(queuePanel, /icon: "sync-pending"/);
  assert.match(queuePanel, /icon: "sync-ok"/);
  assert.match(queuePanel, /icon: "sync-error"/);
  assert.match(queuePanel, /renderIcon\(summary\.icon/);
  assert.match(queuePanel, /renderIcon\("chevron-right"/);
  assert.match(queuePanel, /activity-details-button/);
  assert.equal(/\$\{totals\.pending\} pendientes/.test(queuePanel), false);
  assert.match(queuePanel, /renderActivityDrawer/);
  assert.match(queuePanel, /Puntuaciones con error/);
  assert.match(devTools, /data-action="check-membership"/);
  assert.match(styles, /\.app-main/);
  assert.match(styles, /--launcher-content-max-width: 1760px/);
  assert.match(styles, /\.app-main,\s*\n\.launcher-header[\s\S]*width: min\(100%, var\(--launcher-content-max-width\)\)[\s\S]*max-width: var\(--launcher-content-max-width\)[\s\S]*margin-inline: auto/);
  assert.match(styles, /LOCAL-LAUNCHER-SHELL-DETAIL-HOTFIX-3-FINAL/);
  assert.match(styles, /width: min\(100%, 1840px\)/);
  assert.match(styles, /margin-inline: auto/);
  assert.match(styles, /var\(--library-sidebar-width, 440px\) 8px minmax\(0, 1fr\)/);
  assert.equal(/@media \(max-width: 1080px\)[\s\S]{0,160}\.app-main[\s\S]{0,80}grid-template-columns: 1fr/.test(styles), false);
  assert.match(styles, /\.app-main::before[\s\S]*right: calc\(100% - var\(--library-sidebar-width, 440px\)\)[\s\S]*background: var\(--library-sidebar-bg\)/);
  assert.match(styles, /\.library-resizer/);
  assert.match(styles, /\.library-panel-region/);
  assert.match(styles, /\.game-panel-region/);
  assert.match(styles, /\.brand-lockup/);
  assert.match(styles, /\.app-icon-slot[\s\S]*border: 0[\s\S]*background: transparent/);
  assert.match(styles, /\.app-brand-icon\.ui-icon[\s\S]*width: 48px[\s\S]*height: 48px/);
  assert.match(styles, /\.session-chip--button \.account-mini-avatar[\s\S]*width: 38px[\s\S]*height: 38px/);
  assert.match(styles, /\.action-grid/);
  assert.match(styles, /\.activity-summary-card/);
  assert.match(styles, /LOCAL-LAUNCHER-ICON-VISUAL-POLISH-2/);
  assert.match(styles, /\.launcher-footer/);
  assert.match(styles, /\.theme-button--icon/);
  assert.match(styles, /\.connection-dot/);
  assert.match(styles, /\.activity-details-button/);
  assert.match(styles, /LOCAL-LAUNCHER-ICON-SYSTEM-1/);
  assert.match(styles, /\.ui-icon/);
  assert.match(styles, /\.ui-icon__glyph/);
  assert.match(styles, /\.ui-icon__img/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*width: 100%[\s\S]*height: 100%/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*background-color: currentColor/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*-webkit-mask-image: var\(--icon-url\)[\s\S]*mask-image: var\(--icon-url\)/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*-webkit-mask-size: contain[\s\S]*mask-size: contain/);
  assert.match(styles, /\.ui-icon__fallback/);
  assert.match(styles, /\.action-icon/);
  assert.equal(/\.meta-icon/.test(styles), false);
  assert.match(styles, /\.status-icon/);
  assert.match(styles, /\.account-icon/);
  assert.match(styles, /LOCAL-LAUNCHER-GAME-DETAIL-POLISH-1/);
  assert.match(styles, /LOCAL-LAUNCHER-DETAIL-WIDTH-HERO-STAR-FIX-1/);
  assert.match(styles, /\.game-scroll[\s\S]*scrollbar-gutter: stable both-edges/);
  assert.match(styles, /\.game-detail-card[\s\S]*--game-detail-max-width: clamp\(1180px, calc\(100vw - var\(--library-sidebar-width, 440px\) - 72px\), 1480px\)/);
  assert.match(styles, /\.game-detail-card[\s\S]*width: min\(100%, var\(--game-detail-max-width\)\)[\s\S]*max-width: var\(--game-detail-max-width\)/);
  assert.match(styles, /\.game-detail-card[\s\S]*justify-self: center/);
  assert.equal(styles.lastIndexOf("width: min(100%, var(--game-detail-max-width))") > styles.lastIndexOf("width: min(100%, 1120px)"), true);
  assert.match(styles, /\.game-hero-stage[\s\S]*aspect-ratio: 1920 \/ 620/);
  assert.match(styles, /\.game-hero-stage[\s\S]*width: 100%/);
  assert.match(styles, /\.game-hero-stage[\s\S]*max-height: 320px/);
  assert.match(styles, /\.game-hero-stage[\s\S]*margin-inline: auto/);
  assert.equal(/\.game-hero-stage[\s\S]{0,220}max-height:\s*none/.test(styles), false);
  assert.match(styles, /\.game-hero__logo[\s\S]*position: absolute/);
  assert.match(styles, /\.game-hero__logo[\s\S]*left: 50%/);
  assert.equal(/\.game-hero-stage[\s\S]*max-height: 360px/.test(styles), false);
  assert.match(styles, /\.game-hero__logo[\s\S]*width: auto[\s\S]*max-width: 76%[\s\S]*height: 58%/);
  assert.match(styles, /\.game-hero__logo[\s\S]*max-height: 70%/);
  assert.match(styles, /\.game-hero__logo[\s\S]*object-fit: contain/);
  assert.match(styles, /\.game-hero__logo[\s\S]*transform: translate\(-50%, -50%\)/);
  assert.equal(/\.game-hero__logo[\s\S]*cqw/.test(styles), false);
  assert.match(styles, /\.game-panel__hero[\s\S]*object-fit: cover/);
  assert.match(styles, /\.game-detail-body/);
  assert.match(styles, /\.game-metadata-grid[\s\S]*grid-template-areas:\s*"developer year"\s*"genre playtime"/);
  assert.match(styles, /\.game-metadata-grid[\s\S]*grid-template-columns: minmax\(0, 1fr\) clamp\(220px, 32%, 340px\)/);
  assert.match(styles, /@container \(max-width: 560px\)[\s\S]*"developer developer"[\s\S]*"genre genre"[\s\S]*"year playtime"/);
  assert.match(styles, /\.game-metadata-grid--fallback[\s\S]*"developer developer"[\s\S]*"genre genre"[\s\S]*"year playtime"/);
  assert.match(styles, /\.game-metadata-grid--ellipsis \.game-metadata-label,[\s\S]*\.game-metadata-grid--ellipsis \.game-metadata-value[\s\S]*text-overflow: ellipsis/);
  assert.match(styles, /\.game-title-main[\s\S]*display: flex[\s\S]*gap: 7px/);
  assert.match(styles, /\.game-title-main h2[\s\S]*width: 100%[\s\S]*max-width: 100%/);
  assert.match(styles, /\.game-title-main h2[\s\S]*box-sizing: border-box[\s\S]*padding-inline-end: var\(--favorite-star-safe-space, 0px\)/);
  assert.match(styles, /\.game-title-main:has\(\.game-favorite-mark\) h2[\s\S]*--favorite-star-safe-space: 33px/);
  assert.equal(/game-title-main[\s\S]{0,180}max-width: calc\(100% -/.test(styles), false);
  assert.equal(/:has\(\.game-favorite-mark\)[\s\S]{0,120}max-width: calc/.test(styles), false);
  assert.match(styles, /\.game-favorite-mark[\s\S]*width: 18px[\s\S]*height: 18px[\s\S]*border: 0[\s\S]*background: transparent[\s\S]*cursor: default[\s\S]*pointer-events: none/);
  assert.match(styles, /\.game-favorite-mark[\s\S]*position: absolute[\s\S]*--favorite-mark-left/);
  assert.match(styles, /\.game-favorite-mark\[hidden\][\s\S]*display: none/);
  assert.match(styles, /\.game-favorite-mark--active[\s\S]*background: transparent[\s\S]*var\(--circuit\)/);
  assert.match(styles, /\.game-week-subtitle[\s\S]*text-transform: uppercase/);
  assert.match(styles, /\.game-metadata-icon\.ui-icon,\s*\n\.game-week-icon\.ui-icon[\s\S]*color: color-mix\(in srgb, var\(--text-muted\) 82%, var\(--text\)\)/);
  assert.equal(/@container \(max-width: 720px\)[\s\S]*game-metadata/.test(styles), false);
  const metadataFallbackStyles = styles.slice(
    styles.indexOf("@container (max-width: 560px)"),
    styles.indexOf("@container (max-width: 360px)"),
  );
  assert.equal(/\.game-metadata-icon\.ui-icon[\s\S]*display: none/.test(metadataFallbackStyles), false);
  assert.equal(/game-metadata-grid--no-icons|metadata--no-icons/.test(styles + app), false);
  assert.equal(/@container \(max-width: 360px\)[\s\S]*\.game-metadata-icon\.ui-icon[\s\S]*display: none/.test(styles), false);
  assert.match(styles, /@container \(max-width: 560px\)[\s\S]*\.game-metadata-item--year[\s\S]*border-right: 1px solid var\(--border\)[\s\S]*border-bottom: 0/);
  assert.match(styles, /\.game-metadata-item[\s\S]*border-right: 1px solid var\(--border\)/);
  assert.match(styles, /\.game-metadata-icon \.ui-icon__fallback[\s\S]*display: none !important/);
  assert.match(styles, /\.game-metadata-label[\s\S]*position: absolute !important[\s\S]*clip-path: inset\(50%\)/);
  assert.match(styles, /\.game-metadata-value[\s\S]*font-size: 16px[\s\S]*white-space: nowrap/);
  const metadataBaseStyles = styles.slice(
    styles.indexOf(".game-metadata-grid {"),
    styles.indexOf(".game-metadata-grid--fallback"),
  );
  assert.equal(/text-overflow:\s*ellipsis/.test(metadataBaseStyles), false);
  assert.equal(/game-metadata[\s\S]{0,500}truncate/.test(styles), false);
  assert.equal(/pack-metadata-grid|pack-metadata-item|meta-label|meta-value/.test(styles), false);
  assert.equal(/\.game-metadata-grid[\s\S]{0,260}grid-template-columns:\s*repeat\(4/.test(styles), false);
  assert.match(styles, /LOCAL-LAUNCHER-FAVORITE-ACTIONS-HOTFIX-1/);
  assert.match(styles, /\.game-detail-card \.primary-action-tile[\s\S]*min-height: 92px/);
  assert.match(styles, /\.game-detail-card \.compact-action[\s\S]*min-height: 70px/);
  assert.match(styles, /\.game-detail-card \.play-button \.action-icon\.ui-icon,[\s\S]*\.game-detail-card \.primary-action-tile \.action-icon\.ui-icon[\s\S]*width: 46px[\s\S]*height: 46px/);
  assert.match(styles, /\.game-detail-card \.play-button \.action-icon\.ui-icon[\s\S]*color: var\(--text-inverse\)/);
  assert.match(styles, /\.game-detail-card \.compact-action \.action-icon\.ui-icon[\s\S]*width: 38px[\s\S]*height: 38px/);
  assert.match(styles, /\.game-detail-card \.play-button \.action-button-label,[\s\S]*\.game-detail-card \.primary-action-tile \.action-button-label[\s\S]*font-size: 24px/);
  assert.match(styles, /\.game-detail-card \.compact-action \.action-button-label[\s\S]*font-size: 20px/);
  assert.match(styles, /HSL-MANROPE-TYPOGRAPHY-1/);
  assert.match(styles, /\.game-metadata-value,[\s\S]*\.game-detail-card \.compact-action \.action-button-label[\s\S]*font-weight: 700/);
  assert.match(styles, /\.library-open-label,[\s\S]*\.game-title-main h2,[\s\S]*\.busy-overlay__message,[\s\S]*font-weight: 800/);
  assert.equal(styles.lastIndexOf("font-size: 24px") > styles.lastIndexOf("font-size: 19px"), true);
  assert.equal(styles.lastIndexOf("font-size: 20px") > styles.lastIndexOf("font-size: 16.5px"), true);
  assert.equal(styles.lastIndexOf("width: 46px") > styles.lastIndexOf("width: 40px"), true);
  assert.equal(styles.lastIndexOf("width: 38px") > styles.lastIndexOf("width: 34px"), true);
  assert.match(styles, /\.play-button \.ui-icon__fallback,[\s\S]*\.secondary-action \.ui-icon__fallback[\s\S]*display: none !important/);
  assert.match(styles, /\.favorite-slot--pending[\s\S]*opacity: 1[\s\S]*filter: none[\s\S]*cursor: pointer/);
  assert.equal(/\.favorite-slot--pending[\s\S]{0,80}cursor: wait/.test(styles), false);
  assert.match(styles, /\.pack-card--icons \.pack-card__status-dot[\s\S]*border: 0[\s\S]*box-shadow: none/);
  assert.match(styles, /\.app-icon-slot[\s\S]*width: 52px[\s\S]*height: 52px[\s\S]*border: 0[\s\S]*background: transparent/);
  assert.match(styles, /\.app-brand-icon\.ui-icon[\s\S]*width: 48px[\s\S]*height: 48px[\s\S]*background: transparent/);
  assert.match(styles, /\.app-brand-icon\.ui-icon \.ui-icon__glyph[\s\S]*display: none/);
  assert.match(styles, /\.app-brand-icon\.ui-icon \.ui-icon__img[\s\S]*position: static[\s\S]*width: 100%[\s\S]*height: 100%[\s\S]*opacity: 1[\s\S]*object-fit: contain/);
  assert.match(styles, /\.app-brand-icon\.ui-icon\.ui-icon--missing \.ui-icon__img[\s\S]*display: none/);
  assert.match(styles, /\.pack-card--icons \.pack-card__status--dot[\s\S]*background: transparent[\s\S]*box-shadow: none/);
  assert.match(styles, /\.pack-card--icons \.pack-card__status-dot[\s\S]*border: 0[\s\S]*border-radius: 999px[\s\S]*box-shadow: none/);
  assert.match(styles, /\.action-button-label[\s\S]*overflow: visible/);
  assert.match(styles, /\.game-detail-card \.activity-summary-card/);
  assert.match(styles, /\.game-detail-card \.ready-copy[\s\S]*font-size: 16px[\s\S]*line-height: 1\.6/);
  assert.match(styles, /\.pack-card--covers \.pack-card__media[\s\S]*aspect-ratio: 2 \/ 3/);
  assert.match(app, /Launcher actualizado/);
  assert.match(app, /LAUNCHER_VERSION = "v1\.0\.0"/);
  assert.match(app, /renderStatusFooter/);
  assert.match(styles, /\.theme-icon\.ui-icon--moon[\s\S]*color: var\(--text-inverse\)/);
  assert.match(styles, /\.theme-icon\.ui-icon--sun[\s\S]*color: var\(--surface-strong\)/);
  assert.match(styles, /\.launcher-footer[\s\S]*justify-content: flex-start[\s\S]*gap: 10px/);
  assert.match(styles, /\.launcher-footer__version[\s\S]*color: var\(--text-muted\)/);
  assert.match(app, /function metadataHasOverflow\(grid\)/);
  assert.match(app, /querySelectorAll\("\.game-metadata-value"\)/);
  assert.match(app, /function applyGameMetadataLayout\(grid\)/);
  assert.match(app, /grid\.classList\.remove\([\s\S]*game-metadata-grid--fallback[\s\S]*game-metadata-grid--ellipsis/);
  assert.match(app, /game-metadata-grid--fallback[\s\S]*game-metadata-grid--ellipsis/);
  assert.equal(/game-metadata-grid--no-icons/.test(app), false);
  assert.match(app, /new ResizeObserver\(schedule\)/);
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /syncGameMetadataLayout\(\)/);
  assert.match(app, /function normalizeFavoriteTitleLineRects\(lineRects\)/);
  assert.match(app, /Math\.abs\(current\.top - rect\.top\) <= 2/);
  assert.match(app, /current\.right = Math\.max\(current\.right, rect\.right\)/);
  assert.match(app, /function computeFavoriteStarPosition\(lineRects/);
  assert.match(app, /const maxLineRight = Math\.max\(\.\.\.lines\.map\(\(rect\) => rect\.right\)\)/);
  assert.match(app, /maxLineRight \+ gap/);
  assert.match(app, /minGap = 6/);
  assert.match(app, /maxLineRight \+ safeGap \+ markWidth > containerWidth[\s\S]*return null/);
  assert.equal(/Math\.min\([\s\S]{0,120}containerWidth - markWidth/.test(app), false);
  assert.match(app, /function placeFavoriteTitleMark\(container\)/);
  assert.match(app, /mark\.hidden = true/);
  assert.match(app, /mark\.hidden = false/);
  assert.match(app, /Range|getClientRects/);
  assert.match(app, /--favorite-mark-left/);
  assert.match(styles, /\.modal-layer/);
  assert.match(styles, /\.busy-overlay[\s\S]*position: fixed[\s\S]*inset: 0[\s\S]*z-index: 80/);
  assert.match(styles, /\.busy-overlay[\s\S]*pointer-events: auto/);
  assert.match(styles, /backdrop-filter: blur\(8px\)/);
  assert.match(styles, /\.busy-overlay__panel/);
  assert.match(styles, /width: clamp\(340px, 34vw, 560px\)/);
  assert.match(styles, /@media \(min-width: 1500px\)/);
  assert.match(styles, /\.busy-overlay__media/);
  assert.match(styles, /\.busy-overlay__spinner[\s\S]*animation: busy-overlay-spin/);
  assert.match(styles, /@keyframes busy-overlay-spin/);
  assert.match(busyOverlay, /export function renderBusyOverlay/);
  assert.match(busyOverlay, /export function busyContentFromLabel/);
  assert.match(busyOverlay, /export function busyMessageFromLabel/);
  assert.match(busyOverlay, /state\?\.busy/);
  assert.match(busyOverlay, /state\.busyLabel/);
  assert.match(busyOverlay, /role="status"/);
  assert.match(busyOverlay, /aria-live="polite"/);
  assert.match(busyOverlay, /aria-busy="true"/);
  assert.match(busyOverlay, /src="\.\/assets\/loading\.gif"/);
  assert.match(busyOverlay, /alt="Cargando"/);
  assert.match(busyOverlay, /busy-overlay__spinner/);
  assert.equal(/renderIcon/.test(busyOverlay), false);
  assert.match(appDialog, /export function renderAppDialog/);
  assert.match(appDialog, /role="dialog"/);
  assert.match(appDialog, /aria-modal="true"/);
  assert.match(appDialog, /¿Qué quieres importar\?/);
  assert.match(appDialog, /action: "import-pack-zip"/);
  assert.match(appDialog, /action: "import-pack-folder"/);
  assert.match(appDialog, /action: "close-dialog"/);
  assert.match(appDialog, /icon: "zip"/);
  assert.match(appDialog, /icon: "folder"/);
  assert.match(styles, /\.app-dialog-layer/);
  assert.match(styles, /\.app-dialog__button--primary/);
  assert.match(styles, /\.drawer-layer/);
  assert.match(styles, /#app[\s\S]*width: 100%[\s\S]*height: 100%/);
  assert.match(styles, /\.launcher-header[\s\S]*min-width: 0/);
  assert.match(styles, /\.header-actions[\s\S]*max-width: min\(62%, 760px\)/);
  assert.doesNotMatch(header, /busy-chip/);
  assert.doesNotMatch(styles, /busy-chip/);
  assert.match(header, /connection-chip/);
  assert.match(header, /session-chip/);
  assert.match(header, /toggle-theme/);
  assert.match(header, /show-settings/);
  assert.match(styles, /\.drawer-layer[\s\S]*grid-template-rows: auto 1fr/);
  assert.match(styles, /\.drawer-layer[\s\S]*overflow: hidden/);
  assert.match(styles, /\.drawer-body[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.game-scroll[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.pack-error-panel/);
  assert.match(styles, /\.advanced-shell/);
  assert.match(styles, /\.activity-stats/);
  assert.equal(/\.advanced-entry/.test(styles), false);
  assert.equal(/access_token|refresh_token|Authorization/.test(app + header + gamePanel + queuePanel), false);
});

test("busy overlay renders blocking action messages without touching favorite microactions", async () => {
  const { busyContentFromLabel, busyMessageFromLabel, renderBusyOverlay } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "busy-overlay.js",
  )).href);

  assert.equal(renderBusyOverlay({ busy: false, busyLabel: "Importando pack" }), "");
  assert.equal(busyMessageFromLabel(null), "Cargando...");

  const cases = [
    ["Iniciando", null, null, "startup"],
    ["Activando pack", null, null, "working"],
    ["Importando pack", null, null, "working"],
    ["Eligiendo directorio", null, null, "waiting-user"],
    ["Eligiendo MAME", null, null, "waiting-user"],
    ["Reescaneando", null, null, "working"],
    ["Abriendo competición", null, null, "mame"],
    ["Competición en curso", null, null, "mame"],
    ["Cerrando competición", null, null, "mame"],
    ["Abriendo práctica", null, null, "mame"],
    ["Práctica en curso", null, null, "mame"],
    ["Cerrando práctica", null, null, "mame"],
    ["Subiendo puntuaciones", null, null, "working"],
  ];

  cases.push(["Eligiendo ZIP", null, null, "waiting-user"]);
  cases.push(["Eligiendo carpeta", null, null, "waiting-user"]);

  for (const [label, , , variant] of cases) {
    const content = busyContentFromLabel(label);
    assert.equal(content.variant, variant);
    assert.equal(typeof content.title, "string");
    assert.equal(typeof content.hint, "string");
    assert.ok(content.title.trim().length > 0);
    assert.ok(content.hint.trim().length > 0);
    assert.equal(busyMessageFromLabel(label), content.title);
  }

  const importHtml = renderBusyOverlay({ busy: true, busyLabel: "Importando pack" });
  const fallbackHtml = renderBusyOverlay({ busy: true, busyLabel: null });
  const importContent = busyContentFromLabel("Importando pack");

  assert.match(importHtml, /class="busy-overlay/);
  assert.match(importHtml, /busy-overlay--working/);
  assert.match(importHtml, /role="status"/);
  assert.match(importHtml, /aria-live="polite"/);
  assert.match(importHtml, /aria-busy="true"/);
  assert.equal(importHtml.includes(`aria-label="${importContent.title} ${importContent.hint}"`), true);
  assert.match(importHtml, /src="\.\/assets\/loading\.gif"/);
  assert.match(importHtml, /alt="Cargando"/);
  assert.match(importHtml, /busy-overlay__spinner/);
  assert.equal(importHtml.includes(importContent.title), true);
  assert.equal(importHtml.includes(importContent.hint), true);
  assert.doesNotMatch(importHtml, /El launcher está terminando esta acción\./);
  assert.match(fallbackHtml, /Cargando\.\.\./);
  assert.match(fallbackHtml, /Espera un momento\.\.\./);
});

test("internal import dialog renders choices and accessible controls", async () => {
  const { renderAppDialog } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "app-dialog.js",
  )).href);
  const html = renderAppDialog({ activeDialog: { type: "import-pack" } });
  const styles = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"),
    "utf8",
  );

  assert.match(renderAppDialog({ activeDialog: null }), /^$/);
  assert.match(html, /class="app-dialog-layer"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="app-dialog-import-pack-title"/);
  assert.match(html, /aria-describedby="app-dialog-import-pack-description"/);
  assert.match(html, /¿Qué quieres importar\?/);
  assert.match(html, /Archivo ZIP/);
  assert.match(html, /Carpeta/);
  assert.match(html, /Cancelar/);
  assert.match(html, /data-action="import-pack-zip"/);
  assert.match(html, /data-action="import-pack-folder"/);
  assert.match(html, /data-action="close-dialog"/);
  assert.match(html, /app-dialog__button--primary" type="button" data-action="import-pack-zip"/);
  assert.match(html, /app-dialog__button--primary" type="button" data-action="import-pack-folder"/);
  assert.match(html, /app-dialog__button--secondary" type="button" data-action="close-dialog"/);
  assert.doesNotMatch(html, /app-dialog__button--primary" type="button" data-action="close-dialog"/);
  assert.match(html, /app-dialog__actions--import-pack/);
  assert.match(styles, /\.app-dialog__button--primary[\s\S]*background: var\(--circuit\)[\s\S]*color: var\(--text-inverse\)/);
  assert.match(styles, /\.app-dialog__button--primary \.app-dialog__button-icon[\s\S]*color: var\(--text-inverse\)/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.app-dialog__button\.app-dialog__button--primary[\s\S]*background: var\(--circuit\)[\s\S]*color: var\(--text-inverse\)/);
  assert.match(styles, /\.app-dialog__actions--import-pack \.app-dialog__button--secondary[\s\S]*grid-column: 1 \/ -1/);
  assert.doesNotMatch(styles, /html:not\(\[data-theme="dark"\]\) \.app-dialog__button \{/);
  assert.match(html, /ui-icon--zip/);
  assert.match(html, /ui-icon--folder/);
});

test("missing pack directory dialog renders recovery actions", async () => {
  const { renderAppDialog } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "app-dialog.js",
  )).href);
  const styles = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"),
    "utf8",
  );
  const html = renderAppDialog({ activeDialog: { type: "pack-directory-unavailable" } });

  assert.match(html, /No se encuentra la carpeta de packs/);
  assert.match(html, /Conecta de nuevo la unidad o escoge otra carpeta/);
  assert.match(html, /app-dialog__actions--pack-directory/);
  assert.match(html, /app-dialog__button--primary" type="button" data-action="choose-unavailable-pack-directory"/);
  assert.match(html, /Escoger carpeta/);
  assert.match(html, /app-dialog__button--secondary" type="button" data-action="close-dialog"/);
  assert.match(html, /Cancelar/);
  assert.match(styles, /\.app-dialog__actions[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.app-dialog__actions[\s\S]*grid-template-columns: 1fr/);
  assert.match(styles, /\.app-dialog__button--primary:hover:not\(:disabled\)/);
});

test("renderer muestra fallback HSL limpio cuando falta la biblioteca", async () => {
  const [{ renderGamePanel }, { renderLibraryPanel }] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "components", "game-panel.js")).href),
    import(pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "components", "library-panel.js")).href),
  ]);
  const state = {
    busy: false,
    data: {
      game: null,
      library: {
        directory: {
          available: false,
          configured: true,
          path: "X:\\packs",
          reason: "missing",
          status: "missing",
        },
        packs: [],
        totals: { packs: 0 },
      },
    },
    libraryFavoriteFilter: "all",
    libraryFiltersOpen: true,
    libraryQuery: "",
    librarySeason: "all",
    librarySortBy: "weeks",
    librarySortDirection: "asc",
    libraryStatus: "all",
    libraryView: "covers",
  };
  const gameHtml = renderGamePanel(state);
  const libraryHtml = renderLibraryPanel(state);

  assert.match(gameHtml, /Biblioteca no disponible/);
  assert.match(gameHtml, /No se encuentra tu biblioteca de packs/);
  assert.match(gameHtml, /src="\.\/assets\/hero_hsl\.png"/);
  assert.match(gameHtml, /data-hsl-fallback-hero/);
  assert.doesNotMatch(gameHtml, /High Score League Launcher|Escoger carpeta|Reintentar|data-action=|Space Invaders|data-action="play"|data-action="practice"|data-action="open-manual"|data-action="open-ranking"|badge-row|game-metadata-grid|pack-error-panel|activity-summary-card/);
  assert.match(libraryHtml, /No se encuentra el directorio de packs/);
  assert.match(libraryHtml, /Recupera la carpeta o cambia la ubicación de la biblioteca/);
  assert.match(libraryHtml, /Cambiar ubicación/);
  assert.match(libraryHtml, /Reescanear/);
  assert.equal((libraryHtml.match(/data-action="choose-pack-directory"/g) || []).length, 1);
  assert.equal((libraryHtml.match(/data-action="rescan-pack-directory"/g) || []).length, 1);
  assert.match(libraryHtml, /data-action="toggle-library-filters"[^>]*aria-expanded="false"[^>]*aria-disabled="true"[^>]*disabled/);
  assert.doesNotMatch(libraryHtml, /id="library-filter-card"/);
  assert.doesNotMatch(libraryHtml, /Cada pack debe estar en una subcarpeta directa con pack\.json|ENOENT|EACCES/);

  const inaccessibleHtml = renderLibraryPanel({
    ...state,
    data: {
      ...state.data,
      library: {
        ...state.data.library,
        directory: { ...state.data.library.directory, reason: "inaccessible", status: "inaccessible" },
      },
    },
  });
  assert.match(inaccessibleHtml, /No puedo acceder al directorio de packs/);
  assert.match(inaccessibleHtml, /aria-expanded="false"[^>]*aria-disabled="true"[^>]*disabled/);
  assert.doesNotMatch(inaccessibleHtml, /id="library-filter-card"/);

  const recoveredHtml = renderLibraryPanel({
    ...state,
    libraryFiltersOpen: false,
    data: {
      ...state.data,
      library: {
        ...state.data.library,
        directory: {
          ...state.data.library.directory,
          available: true,
          reason: null,
          status: "available",
        },
      },
    },
  });
  assert.match(recoveredHtml, /data-action="toggle-library-filters"[^>]*aria-expanded="false"[^>]*aria-disabled="false"/);
});

test("renderer controla el dialogo missing una vez y permite reintento explicito", async () => {
  const app = await fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8");

  assert.match(app, /const unavailableDirectoryPrompts = new Set\(\)/);
  assert.match(app, /function unavailableDirectoryDialogPatch\(data\)/);
  assert.match(app, /unavailableDirectoryPrompts\.has\(key\)/);
  assert.match(app, /unavailableDirectoryPrompts\.add\(key\)/);
  assert.match(app, /function resetUnavailableDirectoryPrompt\(data\)/);
  assert.match(app, /function libraryUnavailableStatePatch\(data\)/);
  assert.match(app, /libraryUnavailableStatePatch\(data\)/);
  assert.match(app, /Object\.assign\(statePatch, libraryUnavailableStatePatch\(response\.state\)\)/);
  assert.match(app, /action === "toggle-library-filters"[\s\S]*button\.disabled[\s\S]*!directory\.available[\s\S]*return/);
  assert.match(app, /closest\("\[data-hsl-fallback-hero\]"\)[\s\S]*hero\.hidden = true/);
  assert.match(app, /action === "choose-unavailable-pack-directory"[\s\S]*window\.hslLauncher\.choosePackDirectory\(\)/);
  assert.match(app, /action === "rescan-pack-directory"[\s\S]*resetUnavailableDirectoryPrompt[\s\S]*window\.hslLauncher\.rescanPackDirectory\(\)/);
  assert.match(app, /action === "close-dialog"[\s\S]*activeDialog: null/);
});

test("game detail metadata renders four normalized fields", async () => {
  const { renderGamePanel } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "game-panel.js",
  )).href);
  const html = renderGamePanel({
    busy: false,
    data: {
      autoSync: { status: "idle" },
      bridge: {},
      game: {
        developer: ["Taito", "Midway", "Taito", ""],
        displayName: "Space Invaders",
        genre: "Disparos, Arcade; Disparos",
        playTime: "",
        year: null,
      },
      membership: null,
      readiness: { status: "ready" },
      session: { hasSession: false },
    },
  });

  assert.match(html, /game-metadata-grid/);
  assert.match(html, /game-metadata-item--developer/);
  assert.match(html, /game-metadata-item--year/);
  assert.match(html, /game-metadata-item--genre/);
  assert.match(html, /game-metadata-item--playtime/);
  assert.match(html, /aria-label="Desarrollador: Taito · Midway"/);
  assert.match(html, /aria-label="Año: Sin datos"/);
  assert.match(html, /aria-label="Género: Disparos · Arcade"/);
  assert.match(html, /aria-label="Tiempo jugado: Sin datos"/);
  assert.match(html, /game-metadata-label sr-only/);
  assert.equal(/Empresa|>Tiempo</.test(html), false);
  assert.match(html, /Taito · Midway/);
  assert.match(html, /Disparos · Arcade/);
  assert.match(html, /Sin datos/);
  assert.equal(/game-favorite-mark/.test(html), false);

  const favoriteHtml = renderGamePanel({
    busy: false,
    data: {
      autoSync: { status: "idle" },
      bridge: {},
      game: {
        displayName: "Indiana Jones and the Temple of Doom",
        favorite: true,
        genre: "Aventura",
      },
      membership: null,
      readiness: { status: "ready" },
      session: { hasSession: false },
    },
  });

  assert.match(favoriteHtml, /game-favorite-mark game-favorite-mark--active/);
  assert.match(favoriteHtml, /aria-label="Juego favorito"/);
  assert.match(favoriteHtml, /star-filled/);
  assert.equal(/star-empty|game-favorite-chip|>Favorito</.test(favoriteHtml), false);
});

test("initial renderer state keeps game detail neutral until data is loaded", async () => {
  const { renderGamePanel } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "game-panel.js",
  )).href);
  const html = renderGamePanel({ busy: true, busyLabel: "Iniciando", data: null });

  assert.match(html, /game-detail-card--empty/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, /Space Invaders/);
  assert.doesNotMatch(html, /Listo con avisos/i);
  assert.doesNotMatch(html, /Auto-sync activo/i);
  assert.doesNotMatch(html, /Sin datos/);
  assert.doesNotMatch(html, /data-action="play"/);
  assert.doesNotMatch(html, /data-action="practice"/);
});

test("library pending selection does not become active in any view", async () => {
  const { renderPackCard } = await import(pathToFileURL(path.join(
    __dirname,
    "..",
    "gui",
    "renderer",
    "components",
    "pack-card.js",
  )));
  const activePack = {
    id: "active-pack",
    packDir: "C:/packs/active",
    status: "ready",
    title: "Active Pack",
  };
  const pendingPack = {
    id: "pending-pack",
    packDir: "C:/packs/pending",
    status: "ready",
    title: "Pending Pack",
  };
  const state = {
    busy: true,
    libraryActivationInProgress: true,
    pendingLibraryPackId: "pending-pack",
    data: {
      bridge: { packRoot: "C:/packs/active" },
      session: { hasSession: true },
    },
  };

  for (const view of ["icons", "covers", "list"]) {
    const activeHtml = renderPackCard(activePack, state, view);
    const pendingHtml = renderPackCard(pendingPack, state, view);
    const combined = `${activeHtml}${pendingHtml}`;

    assert.match(activeHtml, /pack-card--active/);
    assert.doesNotMatch(activeHtml, /pack-card--pending/);
    assert.match(pendingHtml, /pack-card--pending/);
    assert.doesNotMatch(pendingHtml, /pack-card--active/);
    assert.equal((combined.match(/pack-card--active/g) || []).length, 1);
  }
});

test("manual and ranking IPC stay in main process", async () => {
  const [main, preload, app] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "preload.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8"),
  ]);

  assert.match(main, /launcher:open-manual/);
  assert.match(main, /shell\.openPath/);
  assert.match(main, /launcher:open-ranking/);
  assert.match(main, /shell\.openExternal/);
  assert.doesNotMatch(main, /launcher:import-pack"/);
  assert.doesNotMatch(main, /showMessageBox/);
  assert.match(main, /showImportZipDialog/);
  assert.match(main, /showImportFolderDialog/);
  assert.match(main, /sendBusyPhase\(event, "Importando pack"\)/);
  assert.match(main, /launcher:busy-phase/);
  assert.match(main, /launcher:import-pack-zip/);
  assert.match(main, /launcher:import-pack-folder/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /minWidth: 1180/);
  assert.match(main, /minHeight: 620/);
  assert.match(preload, /openManual/);
  assert.match(preload, /openRanking/);
  assert.doesNotMatch(preload, /importPack: invoke\("launcher:import-pack"\)/);
  assert.match(preload, /importPackZip: invoke\("launcher:import-pack-zip"\)/);
  assert.match(preload, /importPackFolder: invoke\("launcher:import-pack-folder"\)/);
  assert.match(preload, /onBusyPhase/);
  assert.match(preload, /ipcRenderer\.on\(channel, handler\)/);
  assert.match(app, /window\.hslLauncher\.openManual/);
  assert.match(app, /window\.hslLauncher\.openRanking/);
  assert.doesNotMatch(app, /window\.hslLauncher\.importPack\(\)/);
  assert.match(app, /window\.hslLauncher\.importPackZip\(\)/);
  assert.match(app, /window\.hslLauncher\.importPackFolder\(\)/);
  assert.equal(/nodeIntegration:\s*true/.test(main), false);
});

test("renderer local icon system maps stable SVG names with safe fallbacks", async () => {
  const icon = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "icon.js"),
    "utf8",
  );
  const styles = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"),
    "utf8",
  );
  const starFilled = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "assets", "icons", "star-filled.svg"),
    "utf8",
  );
  const starEmpty = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "assets", "icons", "star-empty.svg"),
    "utf8",
  );

  [
    "app.svg",
    "arrow-down.svg",
    "arrow-up.svg",
    "filter.svg",
    "folder.svg",
    "sun.svg",
    "moon.svg",
    "status-online.svg",
    "status-offline.svg",
    "status-reconnecting.svg",
    "user.svg",
    "play.svg",
    "practice.svg",
    "manual.svg",
    "ranking.svg",
    "refresh.svg",
    "developer.svg",
    "year.svg",
    "genre.svg",
    "playtime.svg",
    "calendar.svg",
    "chevron-right.svg",
    "sync-ok.svg",
    "sync-pending.svg",
    "sync-error.svg",
    "view-covers.svg",
    "view-list.svg",
    "view-icons.svg",
    "star-empty.svg",
    "star-filled.svg",
    "check.svg",
    "warning.svg",
    "error.svg",
    "info.svg",
    "import.svg",
    "library.svg",
    "add.svg",
    "logout.svg",
    "forget-account.svg",
    "email.svg",
    "password.svg",
    "close.svg",
    "connection.svg",
    "zip.svg",
  ].forEach((filename) => assert.match(icon, new RegExp(filename.replace(".", "\\."))));

  assert.match(icon, /const ICON_ROOT = "\.\/assets\/icons\/"/);
  assert.match(icon, /const ICON_MASK_ROOT = "\.\.\/assets\/icons\/"/);
  assert.match(icon, /export function renderIcon/);
  assert.match(icon, /export function iconPath/);
  assert.match(icon, /function iconMaskPath\(name\)/);
  assert.match(icon, /class="ui-icon/);
  assert.match(icon, /style="--icon-url: url\('\$\{escapeHtml\(maskSrc\)\}'\)"/);
  assert.match(icon, /ui-icon__glyph/);
  assert.match(icon, /ui-icon__img/);
  assert.match(icon, /ui-icon__fallback/);
  assert.match(icon, /loading="lazy"/);
  assert.match(icon, /const iconLoadState = globalThis\.__hslIconLoadState/);
  assert.match(icon, /globalThis\.__hslMarkIconLoaded/);
  assert.match(icon, /globalThis\.__hslMarkIconMissing/);
  assert.match(icon, /iconLoadState\.loaded\.has\(id\)/);
  assert.match(icon, /iconLoadState\.missing\.has\(id\)/);
  assert.match(icon, /onload="window\.__hslMarkIconLoaded\('\$\{escapeHtml\(id\)\}', this\)"/);
  assert.match(icon, /onerror="window\.__hslMarkIconMissing\('\$\{escapeHtml\(id\)\}', this\)"/);
  assert.equal(/ui-icon--pending/.test(icon + styles), false);
  assert.match(icon, /escapeHtml\(fallback\)/);
  assert.equal(/https?:\/\//.test(icon), false);
  assert.equal(/innerHTML|\.png|<svg|Authorization|access_token|refresh_token|ui-icon__probe|ui-icon__mask/.test(icon), false);

  for (const svg of [starFilled, starEmpty]) {
    const withoutDoctype = svg.replace(/<!DOCTYPE[^>]+>/gi, "");

    assert.match(svg, /<svg[\s\S]*<\/svg>/i);
    assert.equal(/<script/i.test(svg), false);
    assert.equal(/\bon\w+=/i.test(svg), false);
    assert.equal(/\b(?:href|src|style)=["'][^"']*https?:\/\//i.test(withoutDoctype), false);
    assert.equal(/\b(?:href|src)=["']javascript:/i.test(svg), false);
  }

  assert.match(icon, /"star-empty": \{ fallback: "-", file: "star-empty\.svg" \}/);
  assert.match(icon, /"star-filled": \{ fallback: "\*", file: "star-filled\.svg" \}/);
  assert.match(styles, /\.ui-icon__glyph/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*display: block[\s\S]*width: 100%[\s\S]*height: 100%/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*background-color: currentColor/);
  assert.match(styles, /\.ui-icon__glyph[\s\S]*-webkit-mask-image: var\(--icon-url\)[\s\S]*mask-image: var\(--icon-url\)/);
  assert.match(styles, /\.ui-icon__img/);
  assert.match(styles, /\.ui-icon__img[\s\S]*position: absolute[\s\S]*width: 1px[\s\S]*height: 1px[\s\S]*opacity: 0/);
  assert.match(styles, /\.ui-icon--missing \.ui-icon__glyph,\s*\n\.ui-icon--missing \.ui-icon__img[\s\S]*display: none/);
  assert.match(styles, /\.ui-icon--missing \.ui-icon__fallback[\s\S]*display: grid/);
  assert.equal(/ui-icon__probe|ui-icon__mask/.test(styles), false);
  assert.match(styles, /\.ui-icon\.icon-slot::before[\s\S]*content: none !important/);
});

test("launcher service and renderer expose account switcher without tokens", async () => {
  const service = await fsp.readFile(
    path.join(__dirname, "..", "gui", "launcher-service.js"),
    "utf8",
  );
  const header = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "header.js"),
    "utf8",
  );
  const app = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "app.js"),
    "utf8",
  );
  const preload = await fsp.readFile(
    path.join(__dirname, "..", "gui", "preload.js"),
    "utf8",
  );
  const styles = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"),
    "utf8",
  );

  assert.match(service, /rememberSessionAccount/);
  assert.match(service, /saveRememberedSession/);
  assert.match(service, /switchKnownAccountFromGui/);
  assert.match(service, /toSafeAccountsState/);
  assert.match(service, /removeKnownAccountFromGui/);
  assert.match(service, /removeKnownAccount\(config, session\.userId\)/);
  assert.match(service, /logoutLocal\(config\)/);
  assert.match(header, /<strong>Cuentas<\/strong>/);
  assert.match(header, /data-action="switch-account"/);
  assert.match(header, /data-action="add-account"/);
  assert.match(header, /data-action="remove-known-account"/);
  assert.match(header, /account-row__button/);
  assert.match(header, /account-forget-button/);
  assert.match(header, /Olvidar cuenta/);
  assert.match(header, /Cuenta seleccionada/);
  assert.match(header, /Contraseña/);
  assert.match(header, /Añadir cuenta/);
  assert.match(header, /No has iniciado sesión/);
  assert.match(header, /SESSION_CHIP_EMPTY_LABEL = "Sin sesión"/);
  assert.match(header, /sessionChipContent = session\?\.hasSession[\s\S]*renderAccountAvatar\(activeAccount, "account-chip-avatar"\)/);
  assert.match(header, /session-chip--avatar-only/);
  assert.match(header, /accountCompactLabel/);
  assert.match(header, /activeEmail \? `<p>\$\{escapeHtml\(activeEmail\)\}<\/p>`/);
  assert.match(header, /const email = account\?\.email \|\| accountTitle\(account\)/);
  assert.match(header, /account-row__email/);
  assert.match(header, /<strong class="account-row__email">\$\{escapeHtml\(email\)\}<\/strong>/);
  assert.match(header, /title="\$\{escapeHtml\(sessionChipLabel\)\}"/);
  assert.match(header, /aria-label="\$\{escapeHtml\(sessionChipLabel\)\}"/);
  assert.equal(/Iniciar sesión/.test(header), false);
  assert.equal(/Cerrar sesión/.test(header), false);
  assert.match(header, /sessionChipLabel = session\?\.hasSession \? accountAriaLabel\(activeAccount\) : SESSION_CHIP_EMPTY_LABEL/);
  assert.match(app, /authEmail/);
  assert.match(app, /accountMenuOpen/);
  assert.match(app, /cleanAccountFormState/);
  assert.match(app, /closeAccountMenuState/);
  assert.match(app, /openCleanAccountMenuState/);
  assert.match(app, /openAccountFormState/);
  assert.match(app, /accountMenuPointerStartedInside/);
  assert.match(app, /pointerStartedInsideAccountMenu/);
  assert.match(app, /!pointerStartedInsideAccountMenu[\s\S]*closeAccountMenuState/);
  assert.match(app, /action === "toggle-account-menu"[\s\S]*openCleanAccountMenuState/);
  assert.match(app, /action === "cancel-login"[\s\S]*closeAccountMenuState/);
  assert.match(app, /event\.key !== "Escape"[\s\S]*closeAccountMenuState/);
  assert.match(app, /window\.hslLauncher\.switchAccount/);
  assert.match(app, /window\.hslLauncher\.removeKnownAccount/);
  assert.match(preload, /removeKnownAccount/);
  assert.match(preload, /switchAccount/);
  assert.match(header, /account-row__surface/);
  assert.match(header, /account-row__button[\s\S]*data-action="switch-account"[\s\S]*\$\{forgetButton\}/);
  assert.match(header, /account-forget-button[\s\S]*data-action="remove-known-account"/);
  assert.match(styles, /\.known-accounts--menu li\.account-row[\s\S]*display: block[\s\S]*grid-template-columns: none/);
  assert.match(styles, /\.account-row__surface\s*\{[\s\S]*min-width: 0/);
  assert.match(styles, /\.account-row__button\s*\{[\s\S]*min-width: 0/);
  assert.match(styles, /\.account-row__text\s*\{[\s\S]*min-width: 0/);
  const accountRowEmailRule = styles.match(/\.account-row__email\s*\{[^}]*\}/)?.[0] || "";
  assert.match(accountRowEmailRule, /min-width: 0/);
  assert.match(accountRowEmailRule, /overflow: hidden/);
  assert.match(accountRowEmailRule, /text-overflow: ellipsis/);
  assert.match(accountRowEmailRule, /white-space: nowrap/);
  assert.match(accountRowEmailRule, /color: var\(--text\)/);
  assert.equal(/display:\s*none|visibility:\s*hidden|opacity:\s*0|font-size:\s*0|color:\s*transparent/.test(accountRowEmailRule), false);
  assert.equal(/hasSavedSession|Cambio rápido disponible|Cuenta activa|Activa<\/span>|Cambiar<\/button>|Quitar|No se guardan contrase|Cambiar o cerrar sesi|Las puntuaciones se guardan/.test(header), false);
  assert.equal(/access_token|refresh_token|Authorization/.test(header), false);
});

test("pack directory actions are exposed without legacy location UI", async () => {
  const main = await fsp.readFile(
    path.join(__dirname, "..", "gui", "main.js"),
    "utf8",
  );
  const preload = await fsp.readFile(
    path.join(__dirname, "..", "gui", "preload.js"),
    "utf8",
  );
  const app = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "app.js"),
    "utf8",
  );
  const header = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "header.js"),
    "utf8",
  );
  const libraryPanel = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "library-panel.js"),
    "utf8",
  );
  const devTools = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"),
    "utf8",
  );
  const packCard = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "pack-card.js"),
    "utf8",
  );

  assert.match(main, /launcher:choose-pack-directory/);
  assert.match(main, /launcher:open-pack-directory/);
  assert.match(main, /launcher:choose-shared-mame-runtime/);
  assert.match(main, /launcher:open-shared-mame-runtime/);
  assert.match(main, /launcher:rescan-pack-directory/);
  assert.match(main, /launcher:set-library-preferences/);
  assert.match(main, /launcher:toggle-library-favorite/);
  assert.match(preload, /choosePackDirectory/);
  assert.match(preload, /openPackDirectory/);
  assert.match(preload, /chooseSharedMameRuntime/);
  assert.match(preload, /openSharedMameRuntime/);
  assert.match(preload, /rescanPackDirectory/);
  assert.match(preload, /setLibraryPreferences/);
  assert.match(preload, /toggleLibraryFavorite/);
  assert.match(app, /window\.hslLauncher\.choosePackDirectory/);
  assert.match(app, /window\.hslLauncher\.openPackDirectory/);
  assert.match(app, /window\.hslLauncher\.chooseSharedMameRuntime/);
  assert.match(app, /window\.hslLauncher\.openSharedMameRuntime/);
  assert.match(app, /window\.hslLauncher\.rescanPackDirectory/);
  assert.match(app, /window\.hslLauncher\.setLibraryPreferences/);
  assert.match(app, /window\.hslLauncher\.toggleLibraryFavorite/);
  assert.match(app, /action === "show-settings"/);
  assert.match(header, /data-action="show-settings"/);
  assert.match(libraryPanel, /data-action="choose-pack-directory"/);
  assert.match(libraryPanel, /class="library-open-control"[\s\S]*data-action="open-pack-directory"[\s\S]*library-open-label">Biblioteca<\/span>[\s\S]*data-action="rescan-pack-directory"/);
  assert.equal(/<span>Reescanear<\/span>|<span>Abrir carpeta<\/span>/.test(libraryPanel), false);
  assert.match(devTools, /Biblioteca de packs/);
  assert.match(devTools, /data-action="choose-pack-directory"/);
  assert.match(devTools, /data-action="rescan-pack-directory"/);
  assert.match(devTools, /data-action="open-pack-directory"/);
  assert.match(devTools, /data-action="choose-shared-mame-runtime"/);
  assert.match(packCard, /REQUIERE ATENCION/);
  assert.match(packCard, /LEGACY/);
  assert.match(packCard, /LISTO/);
  assert.equal(/ABIERTO/.test(packCard), false);
  assert.equal(/addLibraryLocation|removeLibraryLocation|launcher:add-library-location|launcher:remove-library-location/.test(main + preload + app), false);
});

test("eventResultToQueueItem maps local event files to renderer-safe rows", () => {
  const row = eventResultToQueueItem("pending", {
    errors: [],
    event: {
      detectedAt: "2026-05-24T22:08:00Z",
      game: "Space Invaders",
      rom: "invaders",
      score: 4320,
      source: "mame_memory",
    },
    filename: "score.json",
    fullPath: "C:/pack/events/pending/score.json",
    ok: true,
    warnings: ["manual confirm"],
  });

  assert.deepEqual(row, {
    box: "pending",
    detectedAt: "2026-05-24T22:08:00Z",
    errors: [],
    failure: null,
    filename: "score.json",
    fullPath: "C:/pack/events/pending/score.json",
    game: "Space Invaders",
    ok: true,
    rom: "invaders",
    score: 4320,
    source: "mame_memory",
    warnings: ["manual confirm"],
  });
});

test("classifyFailureReason explains season membership failures", () => {
  const result = classifyFailureReason("HTTP 403: player is not joined to season");

  assert.match(result.friendlyReason, /temporada|season/i);
  assert.equal(result.technicalReason, "HTTP 403: player is not joined to season");
});

test("eventResultToQueueItem can include failed recovery metadata", () => {
  const row = eventResultToQueueItem("failed", {
    errors: [],
    event: {
      detectedAt: "2026-05-24T22:08:00Z",
      game: "Space Invaders",
      rom: "invaders",
      score: 5210,
      source: "mame_memory",
    },
    filename: "failed-score.json",
    fullPath: "C:/pack/events/failed/failed-score.json",
    ok: true,
    warnings: [],
  }, {
    failure: {
      failedAt: "2026-06-19T00:00:00.000Z",
      friendlyReason: "Tu cuenta no esta unida a esta temporada.",
      noteExists: true,
      notePath: "C:/pack/events/failed/failed-score.json.failed.txt",
      technicalReason: "HTTP 403: not joined",
    },
  });

  assert.equal(row.failure.friendlyReason, "Tu cuenta no esta unida a esta temporada.");
  assert.equal(JSON.stringify(row).includes("access_token"), false);
});

test("adoptNewStagingEvents leaves legacy staging files in place", async () => {
  await withTempDir(async (dir) => {
    const staging = path.join(dir, "staging");
    const scoped = path.join(dir, "scoped");
    await fsp.mkdir(staging, { recursive: true });
    await fsp.mkdir(scoped, { recursive: true });
    await fsp.writeFile(path.join(staging, "old.json"), JSON.stringify({ score: 1 }), "utf8");
    const snapshot = await listPendingFileSnapshot(staging);

    const result = await adoptNewStagingEvents(staging, scoped, snapshot, Date.now());

    assert.deepEqual(result.adopted, []);
    assert.deepEqual(result.skippedLegacy, ["old.json"]);
    assert.equal(await fsp.readFile(path.join(staging, "old.json"), "utf8"), JSON.stringify({ score: 1 }));
  });
});

test("adoptNewStagingEvents moves new staging files safely", async () => {
  await withTempDir(async (dir) => {
    const staging = path.join(dir, "staging");
    const scoped = path.join(dir, "scoped");
    await fsp.mkdir(staging, { recursive: true });
    await fsp.mkdir(scoped, { recursive: true });
    await fsp.writeFile(path.join(scoped, "new.json"), "existing", "utf8");
    const snapshot = await listPendingFileSnapshot(staging);
    await fsp.writeFile(path.join(staging, "new.json"), "new-score", "utf8");

    const result = await adoptNewStagingEvents(staging, scoped, snapshot, Date.now() - 1000);

    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].restoredFilename, "new__2.json");
    assert.equal(await fsp.readFile(path.join(scoped, "new.json"), "utf8"), "existing");
    assert.equal(await fsp.readFile(path.join(scoped, "new__2.json"), "utf8"), "new-score");
    await assert.rejects(() => fsp.access(path.join(staging, "new.json")));
  });
});

test("readPackForGui loads a valid external pack from a folder", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validPack()), "utf8");
    await fsp.mkdir(path.join(dir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(dir, "assets", "hero.png"), "png", "utf8");
    await fsp.writeFile(path.join(dir, "metadata.json"), JSON.stringify({
      title: "Space Invaders Deluxe",
      subtitle: "Pack de prueba",
      shortDescription: "Descripcion local del pack.",
      assets: {
        hero: "assets/hero.png",
      },
    }), "utf8");

    const result = readPackForGui(dir);

    assert.equal(result.ok, true);
    assert.equal(result.pack.packRoot, dir);
    assert.equal(result.pack.rom, "invaders");
    assert.equal(result.pack.weekId, "week-1");
    assert.equal(result.pack.metadata.title, "Space Invaders Deluxe");
    assert.equal(result.pack.metadata.assets.hero.relativePath, "assets/hero.png");
  });
});

test("pack metadata detects conventional local assets safely", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validPack()), "utf8");
    await fsp.mkdir(path.join(dir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(dir, "assets", "cover.webp"), "cover", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "icon.ico"), "icon", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "hero.jpg"), "hero", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "logo.png"), "logo", "utf8");

    const result = readPackForGui(dir);

    assert.equal(result.ok, true);
    assert.equal(result.pack.metadata.assets.cover.relativePath, "assets/cover.webp");
    assert.equal(result.pack.metadata.assets.icon.relativePath, "assets/icon.ico");
    assert.equal(result.pack.metadata.assets.hero.relativePath, "assets/hero.jpg");
    assert.equal(result.pack.metadata.assets.logo.relativePath, "assets/logo.png");
    assert.match(result.pack.metadata.assets.cover.url, /^file:/);
    assert.equal(result.pack.metadataLoaded, false);
  });
});

test("library uses cover and icon assets with metadata priority", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const packDir = await writeValidPack(libraryRoot);
    await fsp.mkdir(path.join(packDir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(packDir, "assets", "cover.png"), "conventional-cover", "utf8");
    await fsp.writeFile(path.join(packDir, "assets", "icon.png"), "conventional-icon", "utf8");
    await fsp.writeFile(path.join(packDir, "assets", "custom-icon.png"), "metadata-icon", "utf8");
    await fsp.writeFile(path.join(packDir, "metadata.json"), JSON.stringify({
      assets: {
        icon: "assets/custom-icon.png",
      },
    }), "utf8");
    await setPackDirectory(config, libraryRoot);

    const library = await scanPackLibrary(config);
    const pack = library.packs[0];

    assert.equal(pack.cover.relativePath, "assets/cover.png");
    assert.equal(pack.icon.relativePath, "assets/custom-icon.png");
    assert.equal(pack.logo, null);
    assert.equal(pack.hero, null);
  });
});

test("pack metadata rejects unsafe explicit assets and keeps conventional fallback", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validPack()), "utf8");
    await fsp.mkdir(path.join(dir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(dir, "assets", "cover.png"), "cover", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "icon.png"), "icon", "utf8");
    await fsp.writeFile(path.join(dir, "metadata.json"), JSON.stringify({
      assets: {
        cover: "../outside.png",
        hero: path.join(dir, "outside.png"),
        icon: "https://example.com/icon.png",
      },
    }), "utf8");

    const result = readPackForGui(dir);

    assert.equal(result.ok, true);
    assert.equal(result.pack.metadata.assets.cover.relativePath, "assets/cover.png");
    assert.equal(result.pack.metadata.assets.icon.relativePath, "assets/icon.png");
    assert.ok(result.pack.metadataWarnings.some((warning) => /assets\.cover no puede salir/.test(warning)));
    assert.ok(result.pack.metadataWarnings.some((warning) => /assets\.hero debe ser una ruta relativa/.test(warning)));
    assert.ok(result.pack.metadataWarnings.some((warning) => /assets\.icon debe ser una ruta relativa/.test(warning)));
    assert.equal(JSON.stringify(result.pack.metadata.assets).includes("https://"), false);
  });
});

test("readPackForGui reports a missing pack.json without throwing", async () => {
  await withTempDir(async (dir) => {
    const result = readPackForGui(dir);

    assert.equal(result.ok, false);
    assert.equal(result.code, "missing_pack_json");
    assert.match(result.errors.join("\n"), /pack\.json/);
  });
});

test("readPackForGui reports pack validation errors", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify({ packVersion: 1 }), "utf8");

    const result = readPackForGui(dir);

    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_pack");
    assert.ok(result.errors.some((item) => /gameId/.test(item)));
    assert.ok(result.errors.some((item) => /mame/.test(item)));
  });
});

test("deriveOpenedPackConfig resolves MAME and plugin queue from the opened pack", async () => {
  await withTempDir(async (dir) => {
    const pack = {
      ...validPack(),
      packPath: path.join(dir, "pack.json"),
      packRoot: dir,
    };
    const baseConfig = {
      clientVersion: "0.1.0",
      configExists: true,
      configPath: path.join(dir, "app", "config.json"),
      configSource: "config.json",
      defaultWeekId: "dev-week",
      eventsPendingDirAbs: path.join(dir, "dev", "pending"),
      sessionFileAbs: path.join(dir, "userData", "session.json"),
      supabaseAnonKey: "anon-key",
      supabaseUrl: "https://example.supabase.co",
      userDataDir: path.join(dir, "userData"),
      webBaseUrl: "https://dev.example",
    };

    const config = deriveOpenedPackConfig(baseConfig, pack);
    const packMameRoot = path.join(dir, "mame");

    assert.equal(config.configSource, "pack abierto");
    assert.equal(config.defaultWeekId, "week-1");
    assert.equal(config.webBaseUrl, "https://high-score-league.example");
    assert.equal(config.mame.executablePath, path.join(packMameRoot, "mame.exe"));
    assert.equal(config.mame.workingDir, packMameRoot);
    assert.equal(config.mame.pluginName, "hsl-score");
    assert.equal(config.eventsPendingDirAbs, path.join(packMameRoot, "plugins", "hsl-score", "events", "pending"));
    assert.equal(config.eventsSentDirAbs, path.join(packMameRoot, "plugins", "hsl-score", "events", "sent"));
    assert.equal(config.eventsFailedDirAbs, path.join(packMameRoot, "plugins", "hsl-score", "events", "failed"));
    assert.equal(config.sessionFileAbs, baseConfig.sessionFileAbs);
    assert.equal(config.configPath, baseConfig.configPath);
  });
});

test("resolveRememberedPack loads a valid remembered pack", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const packDir = await writeValidPack(dir);
    await writeLastOpenedPack(config, packDir, {
      updatedAt: "2026-06-19T00:00:00.000Z",
    });

    const result = await resolveRememberedPack(config);

    assert.equal(result.ok, true);
    assert.equal(result.reason, "ok");
    assert.equal(result.pack.packRoot, packDir);
    assert.equal(result.notice.summary, "Último pack cargado correctamente.");
  });
});

test("resolveRememberedPack falls back when remembered pack folder is missing", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    await writeLastOpenedPack(config, path.join(dir, "missing-pack"), {
      updatedAt: "2026-06-19T00:00:00.000Z",
    });

    const result = await resolveRememberedPack(config);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing_dir");
    assert.match(result.notice.summary, /No se pudo cargar el último pack/);
  });
});

test("activateLibraryPack activa un pack detectado y lo recuerda", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const packDir = await writeValidPack(libraryRoot);
    await setPackDirectory(config, libraryRoot);
    const library = await scanPackLibrary(config);

    const result = await activateLibraryPack(library.packs[0].id, {
      config,
      includeState: false,
    });
    const recentRaw = await fsp.readFile(path.join(config.userDataDir, "packs", "recent.json"), "utf8");
    const recent = JSON.parse(recentRaw);

    assert.equal(result.ok, true);
    assert.equal(result.action, "use-library-pack");
    assert.equal(result.pack.packRoot, packDir);
    assert.equal(recent.lastOpenedPackDir, packDir);
  });
});

test("deriveOpenedPackConfig keeps packVersion 2 on shared-runtime pending paths", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validV2Pack()), "utf8");
    const loaded = readPackForGui(dir);
    const baseConfig = {
      eventsBaseDirAbs: path.join(dir, "userData", "events"),
      eventsPendingDirAbs: path.join(dir, "userData", "events", "pending"),
      eventsSentDirAbs: path.join(dir, "userData", "events", "sent"),
      eventsFailedDirAbs: path.join(dir, "userData", "events", "failed"),
      sessionFileAbs: path.join(dir, "userData", "session.json"),
      userDataDir: path.join(dir, "userData"),
      webBaseUrl: "https://dev.example",
    };

    assert.equal(loaded.ok, true);

    const config = deriveOpenedPackConfig(baseConfig, loaded.pack);

    assert.equal(config.requiresSharedMameRuntime, true);
    assert.equal(config.mame.executablePath, null);
    assert.equal(config.mame.workingDir, null);
    assert.equal(config.mame.pluginName, "hsl-score");
    assert.equal(config.mameSource, "shared-runtime-pending");
    assert.equal(config.eventQueueRole, "legacy-global");
    assert.equal(config.eventsPendingDirAbs, baseConfig.eventsPendingDirAbs);
    assert.equal(config.legacyEventsPendingDirAbs, baseConfig.eventsPendingDirAbs);
    assert.equal(config.pack.contractStatus, "current");
  });
});

test("readPackForGui loads a valid packVersion 2 folder", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validV2Pack()), "utf8");

    const result = readPackForGui(dir);

    assert.equal(result.ok, true);
    assert.equal(result.pack.packVersion, 2);
    assert.equal(result.pack.contractStatus, "current");
    assert.equal(result.pack.contract.mame.romDir, path.join(dir, "roms"));
    assert.equal(result.pack.contract.capture.adapterPath, path.join(dir, "scripts", "invaders.lua"));
  });
});

test("openConfiguredPackDirectory calls shell opener for existing directory", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const opened = [];
    await fsp.mkdir(libraryRoot);
    await setPackDirectory(config, libraryRoot);

    const result = await openConfiguredPackDirectory({
      config,
      includeState: false,
      openPathImpl: async (directoryPath) => {
        opened.push(directoryPath);
        return "";
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(opened, [libraryRoot]);
  });
});

test("chooseSharedMameRuntimeFromGui guarda runtime MAME compartido", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const mamePath = path.join(dir, "runtime", "mame.exe");
    await fsp.mkdir(path.dirname(mamePath), { recursive: true });
    await fsp.writeFile(mamePath, "binary", "utf8");

    const result = await chooseSharedMameRuntimeFromGui(mamePath, {
      config,
      includeState: false,
      selectedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    const raw = JSON.parse(await fsp.readFile(path.join(config.userDataDir, "runtime", "mame-runtime.json"), "utf8"));

    assert.equal(result.ok, true);
    assert.equal(result.runtime.available, true);
    assert.equal(raw.mameExecutablePath, mamePath);
  });
});

test("openSharedMameRuntimeDirectory abre carpeta configurada", async () => {
  await withTempDir(async (dir) => {
    const opened = [];
    const mamePath = path.join(dir, "runtime", "mame.exe");
    const result = await openSharedMameRuntimeDirectory({
      config: {
        sharedMameRuntime: {
          mameExecutablePath: mamePath,
        },
      },
      includeState: false,
      openPathImpl: async (runtimeDir) => {
        opened.push(runtimeDir);
        return "";
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(opened, [path.dirname(mamePath)]);
  });
});

test("rescanPackDirectory returns fresh state action", async () => {
  const result = await rescanPackDirectory({
    includeState: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "rescan-pack-directory");
});

test("getLauncherState neutraliza el pack activo si falta el directorio configurado", async () => {
  await withTempDir(async (dir) => {
    const missingRoot = path.join(dir, "missing-library");
    const stalePackRoot = path.join(missingRoot, "Space Invaders");
    const config = {
      pack: validPack(),
      packLoaded: true,
      packPath: path.join(stalePackRoot, "pack.json"),
      packRoot: stalePackRoot,
      userDataDir: path.join(dir, "userData"),
    };
    await writePackDirectory(config, missingRoot);

    const state = await getLauncherState({ config });

    assert.equal(state.library.directory.configured, true);
    assert.equal(state.library.directory.available, false);
    assert.equal(state.library.directory.reason, "missing");
    assert.equal(state.game, null);
    assert.equal(state.bridge.mode, "library-unavailable");
    assert.equal(state.bridge.activePackName, null);
    assert.equal(state.bridge.packRoot, null);
    assert.equal(state.bridge.packLoaded, false);
    assert.equal(state.readiness.canPractice, false);
    assert.equal(state.readiness.canPlayCompetition, false);
  });
});

test("choosePackDirectory funciona despues de un estado missing", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    const missingRoot = path.join(dir, "missing-library");
    const replacementRoot = path.join(dir, "replacement-library");
    await writePackDirectory(config, missingRoot);
    await fsp.mkdir(replacementRoot, { recursive: true });

    const result = await choosePackDirectoryFromGui(replacementRoot, { config });

    assert.equal(result.ok, true);
    assert.equal(result.state.library.directory.path, path.resolve(replacementRoot));
    assert.equal(result.state.library.directory.available, true);
    assert.equal(result.state.library.directory.reason, null);
  });
});

test("rescan mantiene mensaje de jugador cuando el directorio sigue missing", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    await writePackDirectory(config, path.join(dir, "missing-library"));

    const result = await rescanPackDirectory({ config });

    assert.equal(result.ok, true);
    assert.equal(result.summary, "No se encuentra el directorio de packs.");
    assert.doesNotMatch(result.summary, /ENOENT|pack\.json|subcarpeta directa/);
    assert.equal(result.state.library.directory.reason, "missing");
  });
});

test("diagnostico recomienda recuperar o cambiar una biblioteca missing", async () => {
  await withTempDir(async (dir) => {
    const config = { userDataDir: path.join(dir, "userData") };
    await writePackDirectory(config, path.join(dir, "missing-library"));

    const result = await runDiagnose({
      config,
      diagnosticLogOptions: { now: "2026-07-13T10:00:00.000Z" },
    });

    assert.ok(result.report.recommendations.some((item) => /Recupera la unidad.*ubicación de la biblioteca/.test(item)));
    assert.equal(result.diagnosticLog.payload.library.directory.available, false);
    assert.equal(result.diagnosticLog.payload.library.directory.reason, "missing");
  });
});

test("activateLibraryPack selecciona grupo duplicado sin abrir el pack equivocado", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const first = path.join(libraryRoot, "First");
    const second = path.join(libraryRoot, "Second");

    for (const packDir of [first, second]) {
      await writeValidV2PackDir(packDir);
    }

    await setPackDirectory(config, libraryRoot);
    const library = await scanPackLibrary(config);
    const result = await activateLibraryPack(library.packs[0].id, {
      config,
    });

    assert.equal(library.packs.length, 1);
    assert.equal(library.packs[0].duplicateGroup, true);
    assert.equal(result.ok, true);
    assert.match(result.summary, /duplicado/i);
    assert.deepEqual(result.pack.duplicatePaths.sort(), [first, second].sort());
    assert.equal(result.state.bridge.mode, "duplicate-group");
    assert.equal(result.state.readiness.canPractice, false);
    assert.equal(result.state.readiness.canPlayCompetition, false);
    assert.deepEqual(result.state.game.duplicatePaths.sort(), [first, second].sort());
  });
});

test("rescanPackDirectory reconcilia un duplicado resuelto con el pack real", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const first = path.join(libraryRoot, "First");
    const second = path.join(libraryRoot, "Second");

    await writeValidV2PackDir(first);
    await writeValidV2PackDir(second);
    await setPackDirectory(config, libraryRoot);
    const library = await scanPackLibrary(config);

    await activateLibraryPack(library.packs[0].id, { config });
    await fsp.rm(second, { recursive: true, force: true });
    const result = await rescanPackDirectory({ config });

    assert.equal(result.ok, true);
    assert.equal(result.state.bridge.mode, "opened-pack");
    assert.equal(result.state.bridge.packRoot, first);
    assert.equal(result.state.game.duplicateGroup, null);
  });
});

test("rescanPackDirectory mantiene actualizado un duplicado que sigue existiendo", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const first = path.join(libraryRoot, "First");
    const second = path.join(libraryRoot, "Second");
    const third = path.join(libraryRoot, "Third");

    await writeValidV2PackDir(first);
    await writeValidV2PackDir(second);
    await setPackDirectory(config, libraryRoot);
    const library = await scanPackLibrary(config);

    await activateLibraryPack(library.packs[0].id, { config });
    await fsp.rm(second, { recursive: true, force: true });
    await writeValidV2PackDir(third);
    const result = await rescanPackDirectory({ config });

    assert.equal(result.ok, true);
    assert.equal(result.state.bridge.mode, "duplicate-group");
    assert.deepEqual(result.state.game.duplicatePaths.sort(), [first, third].sort());
  });
});

test("rescanPackDirectory limpia un duplicado seleccionado que desaparece", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const first = path.join(libraryRoot, "First");
    const second = path.join(libraryRoot, "Second");

    await writeValidV2PackDir(first);
    await writeValidV2PackDir(second);
    await setPackDirectory(config, libraryRoot);
    const library = await scanPackLibrary(config);

    await activateLibraryPack(library.packs[0].id, { config });
    await fsp.rm(first, { recursive: true, force: true });
    await fsp.rm(second, { recursive: true, force: true });
    const result = await rescanPackDirectory({ config });

    assert.equal(result.ok, true);
    assert.notEqual(result.state.bridge.mode, "duplicate-group");
    assert.deepEqual(result.state.game.duplicatePaths, []);
  });
});

test("importPackFromZipForGui importa, reescanea y activa por ruta final", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const sourcePack = path.join(dir, "source-pack");
    const zipPath = path.join(dir, "pack.zip");
    await fsp.mkdir(libraryRoot, { recursive: true });
    await setPackDirectory(config, libraryRoot);
    await writeValidV2PackDir(sourcePack);
    await fsp.writeFile(path.join(sourcePack, "metadata.json"), JSON.stringify({ title: "Imported Zip" }), "utf8");
    await createZipFromDir(sourcePack, zipPath, "Imported Zip");

    const result = await importPackFromZipForGui(zipPath, {
      config,
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, "import-pack");
    assert.equal(result.packDir, path.join(libraryRoot, "Imported Zip"));
    assert.equal(result.state.bridge.mode, "opened-pack");
    assert.equal(result.state.bridge.packRoot, result.packDir);
    assert.ok(result.state.library.packs.some((pack) => pack.packDir === result.packDir));
  });
});

test("importPackFromFolderForGui importa y no toca favoritos ni cola scoped", async () => {
  await withTempDir(async (dir) => {
    const config = {
      eventsBaseDirAbs: path.join(dir, "userData", "events"),
      eventsPendingDirAbs: path.join(dir, "userData", "events", "pending"),
      eventsSentDirAbs: path.join(dir, "userData", "events", "sent"),
      eventsFailedDirAbs: path.join(dir, "userData", "events", "failed"),
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const sourcePack = path.join(dir, "source-folder");
    await fsp.mkdir(libraryRoot, { recursive: true });
    await setPackDirectory(config, libraryRoot);
    await writeValidV2PackDir(sourcePack);
    await fsp.writeFile(path.join(sourcePack, "metadata.json"), JSON.stringify({ title: "Imported Folder" }), "utf8");

    const result = await importPackFromFolderForGui(sourcePack, {
      config,
    });

    assert.equal(result.ok, true);
    assert.equal(result.state.library.favorites.count, 0);
    assert.equal(result.state.scope, null);
    assert.equal(result.state.queue.totals.pending, 0);
  });
});

test("importPackFromFolderForGui informa si no hay directorio de packs", async () => {
  await withTempDir(async (dir) => {
    const sourcePack = path.join(dir, "source-folder");
    await writeValidV2PackDir(sourcePack);

    const result = await importPackFromFolderForGui(sourcePack, {
      config: {
        userDataDir: path.join(dir, "userData"),
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.summary, /directorio de packs/);
  });
});

test("error de importacion no cambia activeOpenedPack", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const installed = path.join(libraryRoot, "Installed");
    const broken = path.join(dir, "broken");
    await fsp.mkdir(libraryRoot, { recursive: true });
    await setPackDirectory(config, libraryRoot);
    await writeValidV2PackDir(installed);
    await activateLibraryPack((await scanPackLibrary(config)).packs[0].id, { config });
    await fsp.mkdir(broken, { recursive: true });
    await fsp.writeFile(path.join(broken, "pack.json"), "{", "utf8");

    const result = await importPackFromFolderForGui(broken, {
      config,
    });

    assert.equal(result.ok, false);
    assert.equal(result.state.bridge.packRoot, installed);
  });
});

test("importar carpeta ya instalada se informa como ya en biblioteca", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const installed = path.join(libraryRoot, "Installed");
    await fsp.mkdir(libraryRoot, { recursive: true });
    await setPackDirectory(config, libraryRoot);
    await writeValidV2PackDir(installed);

    const result = await importPackFromFolderForGui(installed, {
      config,
    });

    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, true);
    assert.match(result.summary, /ya estaba en la biblioteca/);
    assert.equal(result.state.bridge.packRoot, installed);
  });
});

test("rescanPackDirectory reconcilia un pack con error que pasa a valido", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const libraryRoot = path.join(dir, "library");
    const packDir = path.join(libraryRoot, "Broken");

    await fsp.mkdir(packDir, { recursive: true });
    await fsp.writeFile(path.join(packDir, "pack.json"), "{", "utf8");
    await setPackDirectory(config, libraryRoot);
    let library = await scanPackLibrary(config);
    const selected = await activateLibraryPack(library.packs[0].id, { config });

    assert.equal(selected.ok, true);
    assert.equal(selected.state.bridge.mode, "pack-issue");

    await writeValidV2PackDir(packDir);
    library = await scanPackLibrary(config);
    assert.equal(library.packs[0].status, "ok");

    const result = await rescanPackDirectory({ config });

    assert.equal(result.ok, true);
    assert.equal(result.state.bridge.mode, "opened-pack");
    assert.equal(result.state.bridge.packRoot, packDir);
  });
});

test("library preferences and favorites stay local to userData", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const session = {
      email: "test3@gmail.com",
      hasSession: true,
      userId: "user-1",
    };

    const preferences = await setLibraryPreferencesFromGui({
      librarySortBy: "developer",
      librarySortDirection: "desc",
      libraryView: "list",
      sidebarWidth: 520,
    }, {
      config,
      includeState: false,
      session,
    });
    const favorite = await toggleLibraryFavoriteFromGui("space-invaders-week-1", {
      config,
      includeState: false,
      now: "2026-06-27T00:00:00.000Z",
      session,
    });

    assert.equal(preferences.ok, true);
    assert.equal(preferences.preferences.librarySortBy, "developer");
    assert.equal(preferences.preferences.librarySortDirection, "desc");
    assert.equal(preferences.preferences.libraryView, "list");
    assert.equal(preferences.preferences.sidebarWidth, 520);
    assert.match(preferences.preferences.filePath, /players/);
    assert.equal(favorite.ok, true);
    assert.equal(favorite.favorites.favorites["space-invaders-week-1"], true);
    assert.match(favorite.favorites.filePath, /players[\\/]user_user-1[\\/]preferences[\\/]favorites\.json$/);
    assert.equal(favorite.favorites.scope, "player");
    assert.equal(JSON.stringify(preferences).includes("access_token"), false);
    assert.equal(JSON.stringify(favorite).includes("refresh_token"), false);
  });
});

test("library favorites require session from GUI", async () => {
  await withTempDir(async (dir) => {
    const config = {
      userDataDir: path.join(dir, "userData"),
    };
    const result = await toggleLibraryFavoriteFromGui("space-invaders-week-1", {
      config,
      includeState: false,
      now: "2026-06-27T00:00:00.000Z",
      session: { hasSession: false },
    });
    const legacyPath = path.join(config.userDataDir, "library", "favorites.json");

    assert.equal(result.ok, false);
    assert.equal(result.favorites.disabled, true);
    assert.equal(result.favorites.favorites["space-invaders-week-1"], undefined);
    await assert.rejects(fsp.stat(legacyPath), /ENOENT/);
  });
});

test("openPackManual abre archivo local sin exponerlo al renderer", async () => {
  await withTempDir(async (dir) => {
    const manualPath = path.join(dir, "manual", "manual.html");
    const opened = [];
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "<html></html>", "utf8");

    const result = await openPackManual({
      config: {
        pack: {
          packRoot: dir,
        },
      },
      includeState: false,
      openExternalImpl: async () => {
        throw new Error("external should not run");
      },
      openPathImpl: async (target) => {
        opened.push(target);
        return "";
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(opened, [manualPath]);
    assert.equal(JSON.stringify(result).includes(manualPath), false);
  });
});

test("openPackRanking abre fallback web de weekId", async () => {
  const opened = [];
  const result = await openPackRanking({
    config: {
      pack: {
        webBaseUrl: "https://high-score-league.example",
        weekId: "week-1",
      },
    },
    includeState: false,
    openExternalImpl: async (url) => {
      opened.push(url);
    },
    openPathImpl: async () => {
      throw new Error("local should not run");
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(opened, ["https://high-score-league.example/weeks/week-1"]);
});
