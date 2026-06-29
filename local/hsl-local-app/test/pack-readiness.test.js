const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { evaluatePackReadiness } = require("../src/pack-readiness");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-readiness-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function createReadyFixture(root, overrides = {}) {
  const packRoot = path.join(root, "pack");
  const mameRoot = path.join(packRoot, "mame");
  const pluginRoot = path.join(mameRoot, "plugins", "hsl-score");
  const eventsRoot = path.join(pluginRoot, "events");
  const scopedRoot = path.join(root, "userData", "players", "user", "packs", "pack");

  await fsp.mkdir(path.join(mameRoot, "roms"), { recursive: true });
  await fsp.mkdir(path.join(eventsRoot, "pending"), { recursive: true });
  await fsp.mkdir(path.join(eventsRoot, "sent"), { recursive: true });
  await fsp.mkdir(path.join(eventsRoot, "failed"), { recursive: true });
  await fsp.mkdir(scopedRoot, { recursive: true });
  await fsp.writeFile(path.join(mameRoot, "mame.exe"), "binary", "utf8");
  await fsp.writeFile(path.join(mameRoot, "roms", "invaders.zip"), "rom", "utf8");
  await fsp.writeFile(path.join(packRoot, "pack.json"), "{}", "utf8");

  return {
    autoSync: {
      message: "Sincronizacion automatica lista.",
      status: "idle",
    },
    config: {
      defaultWeekId: "week-1",
      eventsBaseDirAbs: eventsRoot,
      eventsFailedDirAbs: path.join(eventsRoot, "failed"),
      eventsPendingDirAbs: path.join(eventsRoot, "pending"),
      eventsSentDirAbs: path.join(eventsRoot, "sent"),
      mame: {
        executablePath: path.join(mameRoot, "mame.exe"),
        pluginName: "hsl-score",
        workingDir: mameRoot,
      },
      pack: {
        gameId: "space-invaders",
        metadataLoaded: false,
        metadataWarnings: [],
        packId: "space-invaders-week-1",
        packRoot,
        rom: "invaders",
        weekId: "week-1",
      },
      packLoaded: true,
      packPath: path.join(packRoot, "pack.json"),
      packRoot,
      webBaseUrl: "https://high-score-league.example",
    },
    membership: {
      canPlayCompetition: true,
      canSubmit: true,
      status: "member",
    },
    queue: {
      totals: {
        failed: 0,
        pending: 0,
        sent: 0,
      },
    },
    scope: {
      scopedQueueRoot: scopedRoot,
    },
    session: {
      email: "player@example.test",
      hasSession: true,
      userId: "user-1",
    },
    ...overrides,
  };
}

test("pack valido con MAME, sesion, member y scope queda ready", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "ready");
    assert.equal(result.canPractice, true);
    assert.equal(result.canPlayCompetition, true);
    assert.equal(result.canCapture, true);
    assert.equal(result.canSubmit, true);
  });
});

test("packVersion 2 no trata userData/events como staging principal", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    const sharedMame = path.join(dir, "runtime", "mame.exe");
    const romDir = path.join(context.config.packRoot, "roms");
    const legacyEventsRoot = path.join(dir, "userData", "events");
    await fsp.mkdir(path.dirname(sharedMame), { recursive: true });
    await fsp.mkdir(romDir, { recursive: true });
    await fsp.writeFile(sharedMame, "binary", "utf8");

    context.config.requiresSharedMameRuntime = true;
    context.config.eventQueueRole = "legacy-global";
    context.config.eventsBaseDirAbs = legacyEventsRoot;
    context.config.eventsPendingDirAbs = path.join(legacyEventsRoot, "pending");
    context.config.eventsSentDirAbs = path.join(legacyEventsRoot, "sent");
    context.config.eventsFailedDirAbs = path.join(legacyEventsRoot, "failed");
    context.config.sharedMameRuntime = {
      available: true,
      configured: true,
      mameExecutablePath: sharedMame,
    };
    context.config.mame = {
      pluginName: "hsl-score",
      requiresSharedMameRuntime: true,
    };
    context.config.pack = {
      ...context.config.pack,
      packVersion: 2,
      contractStatus: "current",
      deprecated: false,
      contract: {
        version: 2,
        runtimeType: "mame",
        mame: {
          romDir,
          romPath: "roms",
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
        },
      },
    };

    const result = evaluatePackReadiness(context);
    const stagingChecks = result.checks.filter((item) => /^staging-(pending|sent|failed)$/.test(item.id));

    assert.deepEqual(stagingChecks, []);
    assert.ok(result.checks.some((item) => item.id === "staging-v2-deferred" && item.level === "ok"));
    assert.equal(result.warnings.some((message) => /Staging pending no esta preparado/.test(message)), false);
    assert.equal(JSON.stringify(result).includes(path.join("userData", "events", "pending")), false);
  });
});

test("sin mame.exe bloquea practica y competicion", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    await fsp.rm(context.config.mame.executablePath);

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "blocked");
    assert.equal(result.canPractice, false);
    assert.equal(result.canPlayCompetition, false);
    assert.match(result.message, /mame\.exe/i);
  });
});

test("sin workingDir bloquea practica", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    await fsp.rm(context.config.mame.workingDir, { recursive: true, force: true });

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "blocked");
    assert.equal(result.canPractice, false);
  });
});

test("sin sesion permite practica pero bloquea competicion y subida", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir, {
      membership: {
        canPlayCompetition: false,
        canSubmit: false,
        status: "no_session",
      },
      scope: null,
      session: {
        hasSession: false,
      },
    });

    const result = evaluatePackReadiness(context);

    assert.equal(result.canPractice, true);
    assert.equal(result.canPlayCompetition, false);
    assert.equal(result.canSubmit, false);
    assert.match(result.message, /sesion/i);
  });
});

test("membership not_member bloquea competicion y subida", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir, {
      membership: {
        canPlayCompetition: false,
        canSubmit: false,
        message: "No participas en esta temporada.",
        status: "not_member",
      },
    });

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "blocked");
    assert.equal(result.canPractice, true);
    assert.equal(result.canPlayCompetition, false);
    assert.equal(result.canSubmit, false);
  });
});

test("membership unknown permite competir con warning pero no subir", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir, {
      membership: {
        canPlayCompetition: true,
        canSubmit: false,
        message: "No se pudo comprobar la participacion.",
        status: "unknown",
      },
    });

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "warning");
    assert.equal(result.canPractice, true);
    assert.equal(result.canPlayCompetition, true);
    assert.equal(result.canSubmit, false);
  });
});

test("falta weekId permite practica pero bloquea competicion y sync", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    context.config.defaultWeekId = null;
    context.config.pack.weekId = null;

    const result = evaluatePackReadiness(context);

    assert.equal(result.canPractice, true);
    assert.equal(result.canPlayCompetition, false);
    assert.equal(result.canSubmit, false);
    assert.ok(result.checks.some((item) => item.id === "week-id" && item.level === "error"));
  });
});

test("metadata warnings y failed generan warnings no bloqueantes para practica", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    context.config.pack.metadataWarnings = ["metadata.json: cover no existe."];
    context.queue.totals.failed = 1;

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "warning");
    assert.equal(result.canPractice, true);
    assert.equal(result.canPlayCompetition, true);
    assert.ok(result.warnings.some((message) => /metadata/i.test(message)));
    assert.ok(result.warnings.some((message) => /error/i.test(message)));
  });
});

test("packVersion 1 deprecated queda como warning no destructivo", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    context.config.pack.packVersion = 1;
    context.config.pack.contractStatus = "deprecated";
    context.config.pack.deprecated = true;
    context.config.pack.deprecationReason = "packVersion 1 puede declarar MAME dentro del pack.";
    context.config.pack.replacement = "packVersion 2";
    context.config.pack.warnings = ["Este pack usa packVersion 1, un contrato legacy/deprecated."];

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "warning");
    assert.equal(result.canPractice, true);
    assert.ok(result.checks.some((item) => item.id === "pack-contract" && item.level === "warning"));
  });
});

test("packVersion 2 sin runtime compartido bloquea practica", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    context.config.requiresSharedMameRuntime = true;
    context.config.sharedMameRuntime = {
      available: false,
      configured: false,
    };
    context.config.mame = {
      pluginName: "hsl-score",
      requiresSharedMameRuntime: true,
    };
    context.config.pack = {
      ...context.config.pack,
      packVersion: 2,
      contractStatus: "current",
      deprecated: false,
      contract: {
        version: 2,
        runtimeType: "mame",
        mame: {
          romDir: path.join(context.config.packRoot, "roms"),
          romPath: "roms",
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
        },
      },
    };

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "blocked");
    assert.equal(result.canPractice, false);
    assert.equal(result.canPlayCompetition, false);
    assert.match(result.message, /Runtime MAME compartido/i);
    assert.ok(result.checks.some((item) => item.id === "runtime-shared" && item.level === "error"));
  });
});

test("packVersion 2 con runtime y romDir permite practica pero no competicion", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    const sharedMame = path.join(dir, "runtime", "mame.exe");
    const romDir = path.join(context.config.packRoot, "roms");
    await fsp.mkdir(path.dirname(sharedMame), { recursive: true });
    await fsp.mkdir(romDir, { recursive: true });
    await fsp.writeFile(sharedMame, "binary", "utf8");

    context.config.requiresSharedMameRuntime = true;
    context.config.sharedMameRuntime = {
      available: true,
      configured: true,
      mameExecutablePath: sharedMame,
    };
    context.config.mame = {
      pluginName: "hsl-score",
      requiresSharedMameRuntime: true,
    };
    context.config.pack = {
      ...context.config.pack,
      packVersion: 2,
      contractStatus: "current",
      deprecated: false,
      contract: {
        version: 2,
        runtimeType: "mame",
        mame: {
          romDir,
          romPath: "roms",
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
        },
      },
    };

    const result = evaluatePackReadiness(context);

    assert.equal(result.status, "blocked");
    assert.equal(result.canPractice, true);
    assert.equal(result.canCapture, false);
    assert.equal(result.canPlayCompetition, false);
    assert.ok(result.checks.some((item) => item.id === "runtime-shared" && item.level === "ok"));
    assert.ok(result.checks.some((item) => item.id === "capture-mode-v2" && item.level === "ok"));
    assert.ok(result.checks.some((item) => item.id === "capture-plugin-v2" && item.level === "ok"));
    assert.ok(result.checks.some((item) => item.id === "capture-adapter-v2" && item.level === "error"));
    assert.ok(result.checks.some((item) => item.id === "capture-v2" && item.level === "error"));
  });
});

test("packVersion 2 con adapter valido permite captura y competicion", async () => {
  await withTempDir(async (dir) => {
    const context = await createReadyFixture(dir);
    const sharedMame = path.join(dir, "runtime", "mame.exe");
    const romDir = path.join(context.config.packRoot, "roms");
    const adapterPath = path.join(context.config.packRoot, "scripts", "invaders.lua");
    await fsp.mkdir(path.dirname(sharedMame), { recursive: true });
    await fsp.mkdir(romDir, { recursive: true });
    await fsp.mkdir(path.dirname(adapterPath), { recursive: true });
    await fsp.writeFile(sharedMame, "binary", "utf8");
    await fsp.writeFile(adapterPath, "return {}", "utf8");

    context.config.requiresSharedMameRuntime = true;
    context.config.sharedMameRuntime = {
      available: true,
      configured: true,
      mameExecutablePath: sharedMame,
    };
    context.config.mame = {
      pluginName: "hsl-score",
      requiresSharedMameRuntime: true,
    };
    context.config.pack = {
      ...context.config.pack,
      packVersion: 2,
      contractStatus: "current",
      deprecated: false,
      contract: {
        version: 2,
        runtimeType: "mame",
        mame: {
          romDir,
          romPath: "roms",
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
          adapter: "scripts/invaders.lua",
          adapterPath,
        },
      },
    };

    const result = evaluatePackReadiness(context);

    assert.equal(result.canPractice, true);
    assert.equal(result.canCapture, true);
    assert.equal(result.canPlayCompetition, true);
    assert.ok(result.checks.some((item) => item.id === "capture-v2" && item.level === "ok"));
  });
});

test("renderer expone resumen visual y checks técnicos sin secretos", async () => {
  const [gamePanel, devTools] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "game-panel.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "components", "dev-tools.js"), "utf8"),
  ]);

  assert.match(gamePanel, /Pack listo/);
  assert.match(gamePanel, /Listo con avisos/);
  assert.match(gamePanel, /readiness\?\.canPractice/);
  assert.match(gamePanel, /readiness\?\.canPlayCompetition/);
  assert.match(devTools, /Preparación del pack/);
  assert.match(devTools, /readiness\.checks/);
  assert.equal(/access_token|refresh_token|Authorization/.test(`${gamePanel}\n${devTools}`), false);
});
