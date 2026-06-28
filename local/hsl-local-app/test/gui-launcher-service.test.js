const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  adoptNewStagingEvents,
  activateLibraryPack,
  classifyFailureReason,
  chooseSharedMameRuntimeFromGui,
  deriveOpenedPackConfig,
  eventResultToQueueItem,
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
  setLibraryPreferencesFromGui,
  summarizeDiagnoseReport,
  toggleLibraryFavoriteFromGui,
} = require("../gui/launcher-service");
const { setPackDirectory } = require("../src/pack-directory");
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
      adapter: "scripts/space-invaders.lua",
    },
  };
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

  assert.match(libraryPanel, /<h2>Biblioteca<\/h2>/);
  assert.match(libraryPanel, /library-count-pill/);
  assert.match(libraryPanel, /renderLibraryCount/);
  assert.match(libraryPanel, /1 \? "pack" : "packs"/);
  assert.match(libraryPanel, /Todavía no has elegido un directorio de packs/);
  assert.match(libraryPanel, /No se han encontrado packs en este directorio/);
  assert.match(libraryPanel, /Sin temporada/);
  assert.equal(/const id = pack\.deprecated/.test(libraryPanel), false);
  assert.match(libraryPanel, /data-action="toggle-library-filters"/);
  assert.match(libraryPanel, /aria-expanded="\$\{filtersOpen \? "true" : "false"\}"/);
  assert.match(libraryPanel, /aria-controls="library-filter-card"/);
  assert.match(libraryPanel, /Más filtros/);
  assert.match(libraryPanel, /Cambiar directorio/);
  assert.match(libraryPanel, /data-library-search/);
  assert.match(libraryPanel, /placeholder="Escribe aquí\.\.\."/);
  assert.match(libraryPanel, /Búsqueda general/);
  assert.match(libraryPanel, /data-library-season/);
  assert.match(libraryPanel, /Temporada/);
  assert.match(libraryPanel, /if \(!state\.libraryFiltersOpen\)/);
  assert.equal(/data-library-status|<span>Estado<\/span>/.test(libraryPanel), false);
  assert.match(libraryPanel, /renderViewButton\(state, "covers", "Portadas", "covers"\)/);
  assert.match(libraryPanel, /renderViewButton\(state, "list", "Lista", "list"\)/);
  assert.match(libraryPanel, /renderViewButton\(state, "icons", "Iconos", "icons"\)/);
  assert.equal(/Vista de logos|Vista de portadas|Vista de lista|Vista de iconos/.test(libraryPanel), false);
  assert.match(libraryPanel, /pack\.developer/);
  assert.match(libraryPanel, /pack\.publisher/);
  assert.match(libraryPanel, /pack\.year/);
  assert.match(libraryPanel, /pack\.genre/);
  assert.match(libraryPanel, /pack\.rom/);
  assert.match(libraryPanel, /data-action="choose-pack-directory"/);
  assert.equal(/data-action="open-pack-directory"/.test(libraryPanel), false);
  assert.equal(/data-action="rescan-pack-directory"/.test(libraryPanel), false);
  assert.equal(/Gestionar biblioteca|<summary>/.test(libraryPanel), false);
  assert.equal(/Juegos instalados|Temporadas y packs disponibles|juegos instalados/.test(libraryPanel), false);
  assert.match(libraryPanel, /renderPackCard\(pack, state, state\.libraryView\)/);
  assert.equal(/Anadir ubicacion|Añadir ubicación|Ubicaciones/.test(libraryPanel), false);
  assert.equal(/Añadir pack|Anadir pack/.test(libraryPanel), false);
  assert.match(emptyState, /library-empty-state/);
  assert.match(packCard, /if \(view === "covers"\) return pack\.cover \|\| pack\.icon \|\| pack\.logo/);
  assert.match(packCard, /return pack\.icon \|\| pack\.cover \|\| pack\.logo/);
  assert.match(packCard, /pack-card__placeholder/);
  assert.match(packCard, /Activa/);
  assert.equal(/Seleccionar|library-use-button|Ya activo/.test(packCard), false);
  assert.match(packCard, /data-action="use-library-pack"/);
  assert.match(packCard, /data-action="toggle-library-favorite"/);
  assert.match(packCard, /data-pack-key/);
  assert.match(packCard, /renderIcon\(favorite \? "star-filled" : "star-empty"/);
  assert.match(packCard, /renderIcon\("calendar"/);
  assert.match(packCard, /renderIcon\(meta\.icon/);
  assert.match(packCard, /Con errores/);
  assert.match(packCard, /pack-card__legacy/);
  assert.match(packCard, /if \(view === "icons"\)/);
  assert.match(packCard, /pack-card__status-dot/);
  assert.match(packCard, /role="img"/);
  assert.match(packCard, /aria-label="\$\{escapeHtml\(meta\.label\)\}"/);
  assert.equal(/Legacy \/ deprecated"\s*}/.test(packCard), false);
  assert.match(packCard, /favorite-slot/);
  assert.match(packCard, /favorite-slot--active/);
  assert.match(styles, /\.library-pack-grid/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-CARDS-1/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-CONTROLS-REVAMP-2/);
  assert.match(styles, /LOCAL-LAUNCHER-LIBRARY-LAYOUT-REFINEMENT-3/);
  assert.match(styles, /\.library-title-row/);
  assert.match(styles, /\.library-count-pill/);
  assert.match(styles, /\.library-control-row--primary[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(styles, /\.library-filter-card/);
  assert.match(styles, /\.library-filter-card[\s\S]*padding: 8px/);
  assert.match(styles, /\.library-search input,\s*\n\.library-filters select[\s\S]*min-height: 32px/);
  assert.match(styles, /\.library-scroll[\s\S]*overflow: hidden/);
  assert.match(styles, /\.library-section--packs[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.library-pack-grid--covers[\s\S]*repeat\(auto-fit, minmax\(156px, 178px\)\)/);
  assert.match(styles, /\.library-pack-grid--list/);
  assert.match(styles, /\.pack-card--list[\s\S]*min-height: 54px/);
  assert.match(styles, /\.pack-card--list \.pack-card__media[\s\S]*aspect-ratio: 1 \/ 1/);
  assert.match(styles, /\.library-pack-grid--icons/);
  assert.match(styles, /--library-icon-tile: 92px/);
  assert.match(styles, /\.library-pack-grid--icons[\s\S]*repeat\(auto-fill, var\(--library-icon-tile\)\)/);
  assert.match(styles, /\.pack-card--icons[\s\S]*width: var\(--library-icon-tile\)/);
  assert.match(styles, /\.pack-card__status-dot--error/);
  assert.match(styles, /\.pack-card--active/);
  assert.match(styles, /\.pack-card__placeholder/);
  assert.match(styles, /\.favorite-slot/);
  assert.match(styles, /\.favorite-slot[\s\S]*place-items: center/);
  assert.match(styles, /\.favorite-slot--active[\s\S]*var\(--circuit\)/);
  assert.equal(/favorite-slot--active[\s\S]{0,140}var\(--warn\)/.test(styles), false);
  assert.match(styles, /\.favorite-icon/);
  assert.match(styles, /\.library-view-icon/);
  assert.match(styles, /\.pack-card--covers \.pack-card__media[\s\S]*aspect-ratio: 2 \/ 3/);
  assert.match(styles, /\.pack-card--icons \.pack-card__media[\s\S]*aspect-ratio: 1 \/ 1/);
  assert.equal(/escapeHtml\(pack\.packDir|escapeHtml\(pack\.packPath/.test(packCard), false);
  assert.equal(/checkSeasonMembership|membership/.test(libraryPanel + packCard), false);
  assert.equal(/access_token|refresh_token|Authorization/.test(libraryPanel + packCard), false);
});

test("renderer product hierarchy includes connection, player actions, activity and advanced options", async () => {
  const [app, header, gamePanel, queuePanel, devTools, styles] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "header.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "game-panel.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "queue-panel.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "styles", "app.css"), "utf8"),
  ]);

  assert.match(app, /app-main/);
  assert.match(app, /--library-sidebar-width/);
  assert.match(app, /library-resizer/);
  assert.match(app, /data-sidebar-resizer/);
  assert.match(app, /libraryFiltersOpen: false/);
  assert.match(app, /action === "toggle-library-filters"/);
  assert.match(app, /store\.setState\(\{ libraryFiltersOpen: !store\.getState\(\)\.libraryFiltersOpen \}\)/);
  assert.match(app, /store\.setState\(\{ libraryQuery: input\.value \}\)/);
  assert.match(app, /store\.setState\(\{ librarySeason: target\.value \}\)/);
  assert.match(app, /setLibraryPreferences/);
  assert.match(app, /toggleLibraryFavorite/);
  assert.match(app, /event\.stopPropagation\(\)/);
  assert.match(app, /persistLibraryPreferences\(\{ libraryView \}\)/);
  assert.match(app, /LIBRARY_SIDEBAR_MIN = 360/);
  assert.match(app, /LIBRARY_SIDEBAR_MAX = 600/);
  assert.match(app, /library-panel-region/);
  assert.match(app, /game-panel-region/);
  assert.match(app, /modal-layer/);
  assert.match(app, /drawer-layer/);
  assert.match(app, /data-overlay-backdrop/);
  assert.match(app, /drawer-body/);
  assert.match(app, /target\?\.matches\("\[data-overlay-backdrop\]"\)/);
  assert.match(app, /data-action="close-overlay"/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /event\.key === "D" && event\.ctrlKey && event\.shiftKey/);
  assert.match(app, /!target\.closest\("\[data-account-menu\]"\)/);
  assert.match(app, /Opciones avanzadas/);
  assert.match(app, /renderLibraryPanel\(state\)[\s\S]*renderGamePanel\(state\)/);
  assert.equal(/renderQueuePanel\(state\)|advanced-entry|show-advanced-options/.test(app), false);
  assert.equal(/renderPlayerSummary/.test(app), false);
  assert.match(header, /High Score League Launcher/);
  assert.match(header, /brand-lockup/);
  assert.match(header, /app-icon-slot/);
  assert.match(header, /renderIcon\("app"/);
  assert.match(header, /renderIcon\(themeIcon/);
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
  assert.equal(/Cambio rápido disponible|Cambio rÃ¡pido disponible|Cuenta activa|badge badge-ok|No se guardan contrase|Las puntuaciones se guardan|No borra puntuaciones/.test(header), false);
  assert.match(gamePanel, /data-action="play"/);
  assert.match(gamePanel, /data-action="practice"/);
  assert.match(gamePanel, /renderContentAction\("open-manual", "Manual"/);
  assert.match(gamePanel, /renderContentAction\("open-ranking", "Ranking"/);
  assert.match(gamePanel, /game-detail-card/);
  assert.match(gamePanel, /game-hero-stage/);
  assert.match(gamePanel, /game-hero-media/);
  assert.match(gamePanel, /game-detail-body/);
  assert.match(gamePanel, /pack-metadata-grid/);
  assert.match(gamePanel, /meta-label/);
  assert.match(gamePanel, /meta-value/);
  assert.match(gamePanel, /renderIcon\(icon/);
  assert.match(gamePanel, /"developer", "Desarrollador"/);
  assert.match(gamePanel, /"year", "Año"/);
  assert.match(gamePanel, /"playtime", "Tiempo jugado"/);
  assert.match(gamePanel, /"Sin datos"/);
  assert.match(gamePanel, /renderIcon\("calendar"/);
  assert.match(gamePanel, /renderIcon\("play"/);
  assert.match(gamePanel, /renderIcon\("practice"/);
  assert.match(gamePanel, /"manual"/);
  assert.match(gamePanel, /renderStatusBadges/);
  assert.match(gamePanel, /\.slice\(0, 4\)/);
  assert.match(gamePanel, /action-button-label/);
  assert.match(gamePanel, /action-grid/);
  assert.match(gamePanel, /renderActivitySummaryCard\(state\)/);
  assert.match(gamePanel, /Pack listo/);
  assert.match(gamePanel, /Participas en la temporada/);
  assert.match(gamePanel, /Auto-sync activo/);
  assert.equal(/getReadyLabel|Competicion|Pack abierto|Ultimo pack cargado|Cola cuenta \+ pack|Pack abierto correctamente|Listo para competir|Sincronizacion automatica lista|data-action="check-membership"/.test(gamePanel), false);
  assert.equal(/game-panel__score/.test(gamePanel), false);
  assert.match(queuePanel, /Actividad local/);
  assert.match(queuePanel, /data-action="show-activity-details"/);
  assert.match(queuePanel, /getActivitySummary/);
  assert.match(queuePanel, /activity-summary-card__label/);
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
  assert.match(styles, /var\(--library-sidebar-width, 440px\) 8px minmax\(0, 1fr\)/);
  assert.match(styles, /\.library-resizer/);
  assert.match(styles, /\.library-panel-region/);
  assert.match(styles, /\.game-panel-region/);
  assert.match(styles, /\.brand-lockup/);
  assert.match(styles, /\.action-grid/);
  assert.match(styles, /\.activity-summary-card/);
  assert.match(styles, /LOCAL-LAUNCHER-ICON-VISUAL-POLISH-2/);
  assert.match(styles, /\.launcher-footer/);
  assert.match(styles, /\.theme-button--icon/);
  assert.match(styles, /\.connection-dot/);
  assert.match(styles, /\.activity-details-button/);
  assert.match(styles, /LOCAL-LAUNCHER-ICON-SYSTEM-1/);
  assert.match(styles, /\.ui-icon/);
  assert.match(styles, /\.ui-icon__img/);
  assert.match(styles, /object-fit: contain/);
  assert.equal(/ui-icon__probe|ui-icon__mask|--icon-url|-webkit-mask|mask-image|mask:/.test(styles), false);
  assert.match(styles, /\.ui-icon__fallback/);
  assert.match(styles, /\.action-icon/);
  assert.match(styles, /\.meta-icon/);
  assert.match(styles, /\.status-icon/);
  assert.match(styles, /\.account-icon/);
  assert.match(styles, /LOCAL-LAUNCHER-GAME-DETAIL-POLISH-1/);
  assert.match(styles, /\.app-main[\s\S]*minmax\(380px, 440px\)/);
  assert.match(styles, /\.game-hero-stage[\s\S]*aspect-ratio: 16 \/ 5/);
  assert.match(styles, /\.game-hero-stage[\s\S]*max-height: 220px/);
  assert.match(styles, /\.game-detail-body/);
  assert.match(styles, /\.pack-metadata-grid[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.meta-label/);
  assert.match(styles, /\.meta-value/);
  assert.match(styles, /\.game-detail-card \.activity-summary-card/);
  assert.match(styles, /\.pack-card--covers \.pack-card__media[\s\S]*aspect-ratio: 2 \/ 3/);
  assert.match(app, /Launcher actualizado/);
  assert.match(app, /LAUNCHER_VERSION = "v1\.0\.0"/);
  assert.match(app, /renderStatusFooter/);
  assert.match(styles, /\.modal-layer/);
  assert.match(styles, /\.drawer-layer/);
  assert.match(styles, /#app[\s\S]*width: 100%[\s\S]*height: 100%/);
  assert.match(styles, /main,\s*\n\.launcher-header[\s\S]*margin-inline: 0/);
  assert.match(styles, /\.drawer-layer[\s\S]*grid-template-rows: auto 1fr/);
  assert.match(styles, /\.drawer-layer[\s\S]*overflow: hidden/);
  assert.match(styles, /\.drawer-body[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.game-scroll[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.advanced-shell/);
  assert.match(styles, /\.activity-stats/);
  assert.equal(/\.advanced-entry/.test(styles), false);
  assert.equal(/access_token|refresh_token|Authorization/.test(app + header + gamePanel + queuePanel), false);
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
  assert.match(preload, /openManual/);
  assert.match(preload, /openRanking/);
  assert.match(app, /window\.hslLauncher\.openManual/);
  assert.match(app, /window\.hslLauncher\.openRanking/);
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

  [
    "app.svg",
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
    "add.svg",
    "logout.svg",
    "forget-account.svg",
    "email.svg",
    "password.svg",
    "close.svg",
    "connection.svg",
  ].forEach((filename) => assert.match(icon, new RegExp(filename.replace(".", "\\."))));

  assert.match(icon, /const ICON_ROOT = "\.\/assets\/icons\/"/);
  assert.match(icon, /export function renderIcon/);
  assert.match(icon, /export function iconPath/);
  assert.match(icon, /class="ui-icon/);
  assert.match(icon, /ui-icon__img/);
  assert.match(icon, /ui-icon__fallback/);
  assert.match(icon, /loading="lazy"/);
  assert.match(icon, /onload="this\.parentElement\.classList\.remove\('ui-icon--missing'\);this\.parentElement\.classList\.add\('ui-icon--loaded'\)"/);
  assert.match(icon, /onerror="this\.parentElement\.classList\.remove\('ui-icon--loaded'\);this\.parentElement\.classList\.add\('ui-icon--missing'\)"/);
  assert.match(icon, /escapeHtml\(fallback\)/);
  assert.equal(/https?:\/\//.test(icon), false);
  assert.equal(/innerHTML|\.png|<svg|Authorization|access_token|refresh_token|--icon-url|ui-icon__probe|ui-icon__mask/.test(icon), false);
  assert.match(styles, /\.ui-icon__img/);
  assert.match(styles, /object-fit: contain/);
  assert.match(styles, /\.ui-icon--missing \.ui-icon__img[\s\S]*display: none/);
  assert.match(styles, /\.ui-icon--missing \.ui-icon__fallback[\s\S]*display: grid/);
  assert.equal(/ui-icon__probe|ui-icon__mask|--icon-url|-webkit-mask|mask-image|mask:/.test(styles), false);
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
    assert.equal(config.eventsPendingDirAbs, baseConfig.eventsPendingDirAbs);
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
    assert.equal(result.pack.contract.capture.adapterPath, path.join(dir, "scripts", "space-invaders.lua"));
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
