const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  adoptNewStagingEvents,
  activateLibraryPack,
  classifyFailureReason,
  deriveOpenedPackConfig,
  eventResultToQueueItem,
  listPendingFileSnapshot,
  readPackForGui,
  recheckSeasonMembership,
  resolveRememberedPack,
  resetAutoSyncStateForTests,
  runAutoSyncIfEligible,
  summarizeDiagnoseReport,
} = require("../gui/launcher-service");
const { addLibraryLocation } = require("../src/library-locations");
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
  const app = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "app.js"),
    "utf8",
  );

  assert.match(gamePanel, /unauthenticated: \["badge-error", "Sesion no valida"\]/);
  assert.match(gamePanel, /error: \["badge-error", "Error de comprobacion"\]/);
  assert.match(gamePanel, /data-action="check-membership"/);
  assert.match(gamePanel, /autoSyncBadge/);
  assert.match(gamePanel, /Sincronizando/);
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
  assert.match(devTools, /Motivo tecnico/);
  assert.match(devTools, /Auto-sync estado/);
  assert.match(devTools, /Auto-sync motivo/);
  assert.equal(/access_token|refresh_token|Authorization|session\.json/.test(devTools), false);
});

test("launcher service and renderer expose account switcher without tokens", async () => {
  const service = await fsp.readFile(
    path.join(__dirname, "..", "gui", "launcher-service.js"),
    "utf8",
  );
  const playerSummary = await fsp.readFile(
    path.join(__dirname, "..", "gui", "renderer", "components", "player-summary.js"),
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

  assert.match(service, /rememberSessionAccount/);
  assert.match(service, /saveRememberedSession/);
  assert.match(service, /switchKnownAccountFromGui/);
  assert.match(service, /toSafeAccountsState/);
  assert.match(service, /removeKnownAccountFromGui/);
  assert.match(playerSummary, /Cuentas recordadas/);
  assert.match(playerSummary, /data-action="switch-account"/);
  assert.match(playerSummary, /data-action="add-account"/);
  assert.match(playerSummary, /data-action="remove-known-account"/);
  assert.match(playerSummary, /hasSavedSession/);
  assert.match(playerSummary, /Cambio rápido disponible/);
  assert.match(app, /authEmail/);
  assert.match(app, /window\.hslLauncher\.switchAccount/);
  assert.match(app, /window\.hslLauncher\.removeKnownAccount/);
  assert.match(preload, /removeKnownAccount/);
  assert.match(preload, /switchAccount/);
  assert.equal(/access_token|refresh_token|Authorization/.test(playerSummary), false);
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
    await addLibraryLocation(config, libraryRoot);
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
