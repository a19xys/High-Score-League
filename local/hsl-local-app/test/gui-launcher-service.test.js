const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  deriveOpenedPackConfig,
  eventResultToQueueItem,
  readPackForGui,
  resolveRememberedPack,
  summarizeDiagnoseReport,
} = require("../gui/launcher-service");
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

test("readPackForGui loads a valid external pack from a folder", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "pack.json"), JSON.stringify(validPack()), "utf8");

    const result = readPackForGui(dir);

    assert.equal(result.ok, true);
    assert.equal(result.pack.packRoot, dir);
    assert.equal(result.pack.rom, "invaders");
    assert.equal(result.pack.weekId, "week-1");
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
