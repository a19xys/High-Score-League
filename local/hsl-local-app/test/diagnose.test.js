const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildDiagnoseReport } = require("../src/diagnose");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-diagnose-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function createBaseConfig(root) {
  const pending = path.join(root, "events", "pending");
  const sent = path.join(root, "events", "sent");
  const failed = path.join(root, "events", "failed");
  const mameRoot = path.join(root, "mame");
  const executablePath = path.join(mameRoot, "mame.exe");
  const pluginDir = path.join(mameRoot, "plugins", "hsl-score");
  const sessionFileAbs = path.join(root, ".hsl-session.json");

  await fsp.mkdir(pending, { recursive: true });
  await fsp.mkdir(sent, { recursive: true });
  await fsp.mkdir(failed, { recursive: true });
  await fsp.mkdir(pluginDir, { recursive: true });
  await fsp.writeFile(executablePath, "", "utf8");

  return {
    eventsPendingDir: pending,
    eventsSentDir: sent,
    eventsFailedDir: failed,
    eventsPendingDirAbs: pending,
    eventsSentDirAbs: sent,
    eventsFailedDirAbs: failed,
    webBaseUrl: "http://localhost:3000",
    defaultWeekId: "week-1",
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    sessionFile: ".hsl-session.json",
    sessionFileAbs,
    clientVersion: "0.1.0",
    mame: {
      executablePath,
      workingDir: mameRoot,
      pluginName: "hsl-score",
    },
  };
}

async function createDevBridgeConfig(root) {
  const appDir = path.join(root, "repo", "local", "hsl-local-app");
  const packRoot = path.join(root, "Downloads", "hsl-invaders");
  const pending = path.join(packRoot, "plugins", "hsl-score", "events", "pending");
  const sent = path.join(packRoot, "plugins", "hsl-score", "events", "sent");
  const failed = path.join(packRoot, "plugins", "hsl-score", "events", "failed");
  const pluginDir = path.join(packRoot, "plugins", "hsl-score");
  const executablePath = path.join(packRoot, "mame.exe");

  await fsp.mkdir(appDir, { recursive: true });
  await fsp.mkdir(pending, { recursive: true });
  await fsp.mkdir(sent, { recursive: true });
  await fsp.mkdir(failed, { recursive: true });
  await fsp.mkdir(pluginDir, { recursive: true });
  await fsp.writeFile(executablePath, "", "utf8");

  return {
    appDir,
    configExists: true,
    configPath: path.join(appDir, "config.json"),
    configSource: "config.json",
    packLoaded: false,
    packPath: path.join(root, "repo", "local", "pack.json"),
    eventsSource: "explicit",
    eventsPendingDir: pending,
    eventsSentDir: sent,
    eventsFailedDir: failed,
    eventsPendingDirAbs: pending,
    eventsSentDirAbs: sent,
    eventsFailedDirAbs: failed,
    webBaseUrl: "https://high-score-league.vercel.app",
    defaultWeekId: "week-1",
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "secret-dev-bridge-anon-key",
    sessionFile: "userData/session.json",
    sessionFileAbs: path.join(root, "userData", "session.json"),
    userDataDir: path.join(root, "userData"),
    clientVersion: "0.1.0",
    mame: {
      executablePath,
      workingDir: packRoot,
      pluginName: "hsl-score",
    },
  };
}

function hasEntry(entries, level, pattern) {
  return entries.some((entry) => entry.level === level && pattern.test(entry.message));
}

test("diagnose detects hsl-score globally active in plugin.ini", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    await fsp.writeFile(path.join(config.mame.workingDir, "plugin.ini"), "hsl-score               1\n", "utf8");

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "WARN", /activado globalmente/));
    assert.ok(report.recommendations.some((item) => /Desactiva hsl-score globalmente/.test(item)));
  });
});

test("diagnose does not fail when plugin.ini is absent", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "INFO", /No se encontró plugin\.ini/));
    assert.equal(report.errors.length, 0);
  });
});

test("diagnose detects the configured plugin folder", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "OK", /plugin encontrado: hsl-score/));
  });
});

test("diagnose detects missing mame.executablePath target", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    await fsp.unlink(config.mame.executablePath);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "ERROR", /mame\.executablePath no existe/));
  });
});

test("diagnose confirms practice does not include the score plugin in launcher args", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.launcher, "OK", /practice invaders no incluirá -plugin hsl-score/));
  });
});

test("diagnose warns when webBaseUrl has no protocol", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    config.webBaseUrl = "high-score-league.vercel.app";

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.config, "WARN", /webBaseUrl no incluye protocolo/));
  });
});

test("diagnose does not error only because no pack or MAME is active", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    delete config.mame;
    config.packLoaded = false;
    config.packPath = path.join(dir, "pack.json");
    config.configSource = "config.json";

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "INFO", /No hay MAME activo/));
    assert.equal(report.errors.some((entry) => /MAME|launcher/i.test(entry.message)), false);
  });
});

test("diagnose reports packVersion 2 missing shared runtime without treating it as embedded MAME", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    config.userDataDir = path.join(dir, "userData");
    config.requiresSharedMameRuntime = true;
    config.mame = {
      pluginName: "hsl-score",
      requiresSharedMameRuntime: true,
    };
    config.packLoaded = true;
    config.pack = {
      packVersion: 2,
      contractStatus: "current",
      deprecated: false,
      contract: {
        version: 2,
        runtimeType: "mame",
        mame: {
          romPath: "roms",
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
          adapter: "scripts/invaders.lua",
        },
      },
    };

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.pack, "INFO", /packVersion = 2/));
    assert.ok(hasEntry(report.sections.pack, "OK", /contractStatus = current/));
    assert.ok(hasEntry(report.sections.runtime, "INFO", /runtime MAME compartido no configurado/));
    assert.ok(hasEntry(report.sections.mame, "ERROR", /requiere runtime MAME compartido configurado/));
    assert.equal(report.sections.mame.some((entry) => /mame\.executablePath falta/.test(entry.message)), false);
  });
});

test("diagnose reports packVersion 2 shared runtime and practice args", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    const sharedMame = path.join(dir, "runtime", "mame.exe");
    const romDir = path.join(dir, "pack", "roms");
    await fsp.mkdir(path.dirname(sharedMame), { recursive: true });
    await fsp.mkdir(romDir, { recursive: true });
    await fsp.writeFile(sharedMame, "binary", "utf8");
    config.sharedMameRuntime = {
      available: true,
      configured: true,
      mameExecutablePath: sharedMame,
      runtimeFile: path.join(config.userDataDir || dir, "runtime", "mame-runtime.json"),
      warnings: [],
    };
    config.requiresSharedMameRuntime = true;
    config.packLoaded = true;
    config.pack = {
      packVersion: 2,
      rom: "invaders",
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

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.runtime, "OK", /mame\.exe compartido encontrado/));
    assert.ok(hasEntry(report.sections.mame, "OK", /runtime MAME compartido para practica/));
    assert.ok(hasEntry(report.sections.launcher, "OK", /practice v2 construye argumentos/));
    assert.ok(hasEntry(report.sections.launcher, "INFO", /competition v2 permanece bloqueada/));
    assert.ok(hasEntry(report.sections.pack, "WARN", /cargador competitivo v2 no esta listo/));
  });
});

test("diagnose reports packVersion 2 capture loader when adapter exists", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    const sharedMame = path.join(dir, "runtime", "mame.exe");
    const packRoot = path.join(dir, "pack");
    const romDir = path.join(packRoot, "roms");
    const adapterPath = path.join(packRoot, "scripts", "invaders.lua");
    await fsp.mkdir(path.dirname(sharedMame), { recursive: true });
    await fsp.mkdir(romDir, { recursive: true });
    await fsp.mkdir(path.dirname(adapterPath), { recursive: true });
    await fsp.writeFile(sharedMame, "binary", "utf8");
    await fsp.writeFile(adapterPath, "return {}", "utf8");
    config.userDataDir = path.join(dir, "userData");
    config.sharedMameRuntime = {
      available: true,
      configured: true,
      mameExecutablePath: sharedMame,
      runtimeFile: path.join(config.userDataDir, "runtime", "mame-runtime.json"),
      warnings: [],
    };
    config.requiresSharedMameRuntime = true;
    config.packLoaded = true;
    config.packRoot = packRoot;
    config.pack = {
      packVersion: 2,
      packRoot,
      rom: "invaders",
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

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.pack, "OK", /cargador competitivo v2 disponible/));
    assert.ok(hasEntry(report.sections.launcher, "OK", /competition v2 se prepara/));
    assert.equal(report.recommendations.some((item) => /LOCAL-MAME-PACK-PLUGIN-LOADING-2/.test(item)), false);
  });
});

test("diagnose detects dev bridge with external MAME pack and existing event dirs", async () => {
  await withTempDir(async (dir) => {
    const config = await createDevBridgeConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.runtime, "INFO", /Modo desarrollo puente detectado/));
    assert.equal(report.errors.length, 0);
  });
});

test("diagnose keeps personal MAME path warning but marks it acceptable for dev bridge", async () => {
  await withTempDir(async (dir) => {
    const config = await createDevBridgeConfig(dir);

    const report = await buildDiagnoseReport(config);
    const warning = report.sections.mame.find((entry) => /rutas absolutas personales/.test(entry.message));

    assert.equal(warning?.level, "WARN");
    assert.ok(warning.detail.some((item) => /aceptable en modo desarrollo puente/.test(item)));
    assert.ok(warning.detail.some((item) => /no debe versionarse ni usarse como pack final/.test(item)));
  });
});

test("diagnose dev bridge report does not expose Supabase anon key", async () => {
  await withTempDir(async (dir) => {
    const config = await createDevBridgeConfig(dir);

    const report = await buildDiagnoseReport(config);
    const serialized = JSON.stringify(report);

    assert.equal(serialized.includes("secret-dev-bridge-anon-key"), false);
  });
});

test("diagnose session summary does not expose tokens", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    await fsp.writeFile(
      config.sessionFileAbs,
      JSON.stringify({
        schemaVersion: 1,
        supabaseUrl: config.supabaseUrl,
        user: {
          id: "user-1",
          email: "test@example.com",
        },
        session: {
          access_token: "secret-access-token",
          refresh_token: "secret-refresh-token",
        },
      }),
      "utf8"
    );

    const report = await buildDiagnoseReport(config);
    const serialized = JSON.stringify(report);

    assert.ok(hasEntry(report.sections.session, "OK", /revision/));
    assert.equal(serialized.includes("test@example.com"), false);
    assert.equal(serialized.includes("secret-access-token"), false);
    assert.equal(serialized.includes("secret-refresh-token"), false);
  });
});

test("diagnose classifies missing userData events as legacy for packVersion 2", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    const legacyRoot = path.join(dir, "userData", "events");
    await fsp.rm(legacyRoot, { recursive: true, force: true });
    config.userDataDir = path.join(dir, "userData");
    config.eventsSource = "eventsBaseDir";
    config.eventQueueRole = "legacy-global";
    config.eventsBaseDirAbs = legacyRoot;
    config.eventsPendingDirAbs = path.join(legacyRoot, "pending");
    config.eventsSentDirAbs = path.join(legacyRoot, "sent");
    config.eventsFailedDirAbs = path.join(legacyRoot, "failed");
    config.requiresSharedMameRuntime = true;
    config.mame = {
      pluginName: "hsl-score",
      requiresSharedMameRuntime: true,
    };
    config.packLoaded = true;
    config.pack = {
      packVersion: 2,
      rom: "invaders",
      weekId: "week-1",
      contractStatus: "current",
      deprecated: false,
      contract: {
        version: 2,
        runtimeType: "mame",
        mame: {
          romPath: "roms",
        },
        capture: {
          mode: "plugin",
          pluginName: "hsl-score",
        },
      },
    };

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.queues, "INFO", /file queue global legacy\/CLI/));
    assert.ok(hasEntry(report.sections.queues, "INFO", /pending no existe/));
    assert.equal(report.errors.some((entry) => /No existe la carpeta pending/.test(entry.message)), false);
    assert.ok(hasEntry(report.sections.queues, "INFO", /plugin staging v2 se prepara por ejecucion/));
  });
});

test("diagnose derives scoped queue from active session without requiring it to exist", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    config.userDataDir = path.join(dir, "userData");
    config.pack = {
      gameId: "space-invaders",
      packId: "space-invaders-week-1",
      rom: "invaders",
      weekId: "week-1",
    };
    await fsp.writeFile(
      config.sessionFileAbs,
      JSON.stringify({
        schemaVersion: 1,
        supabaseUrl: config.supabaseUrl,
        user: {
          id: "User 1",
          email: "player@example.com",
        },
        session: {
          access_token: "secret-access-token",
          refresh_token: "secret-refresh-token",
        },
      }),
      "utf8"
    );

    const report = await buildDiagnoseReport(config);
    const serialized = JSON.stringify(report);

    assert.ok(hasEntry(report.sections.queues, "INFO", /scoped queue actual se derivo/));
    assert.equal(serialized.includes("user_user-1"), true);
    assert.equal(serialized.includes("pack_space-invaders-week-1"), true);
    assert.equal(serialized.includes("secret-access-token"), false);
    assert.equal(serialized.includes("secret-refresh-token"), false);
  });
});
