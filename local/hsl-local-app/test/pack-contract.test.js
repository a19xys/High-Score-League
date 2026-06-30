const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  isUnsafePackRelativePath,
  normalizePackContract,
} = require("../src/pack-contract");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-contract-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function validV1Pack() {
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
  };
}

function validV2Pack(overrides = {}) {
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
    ...overrides,
  };
}

test("v1 se valida y queda normalizado como deprecated", () => {
  const result = normalizePackContract(validV1Pack(), {
    packRoot: "C:/packs/space-invaders",
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.normalized.packVersion, 1);
  assert.equal(result.normalized.contractStatus, "deprecated");
  assert.equal(result.normalized.deprecated, true);
  assert.equal(result.normalized.replacement, "packVersion 2");
  assert.match(result.warnings.join("\n"), /deprecated/i);
});

test("v2 valido queda current y normaliza rutas internas", async () => {
  await withTempDir(async (dir) => {
    const result = normalizePackContract(validV2Pack(), {
      packRoot: dir,
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.normalized.packVersion, 2);
    assert.equal(result.normalized.contractStatus, "current");
    assert.equal(result.normalized.deprecated, false);
    assert.equal(result.normalized.contract.runtimeType, "mame");
    assert.equal(result.normalized.contract.mame.romPath, "roms");
    assert.equal(result.normalized.contract.mame.romDir, path.join(dir, "roms"));
    assert.equal(result.normalized.contract.capture.adapter, "scripts/space-invaders.lua");
    assert.equal(result.normalized.contract.capture.adapterPath, path.join(dir, "scripts", "space-invaders.lua"));
  });
});

test("v2 normaliza perfiles MAME por modo", async () => {
  await withTempDir(async (dir) => {
    const result = normalizePackContract(validV2Pack({
      mame: {
        ...validV2Pack().mame,
        profiles: {
          practice: {
            cfgPath: "cfg/practice",
          },
          competition: {
            cfgPath: "cfg/competition",
            launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
          },
        },
      },
    }), {
      packRoot: dir,
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.normalized.contract.mame.profiles.practice.cfgPath, "cfg/practice");
    assert.equal(result.normalized.contract.mame.profiles.practice.cfgDir, path.join(dir, "cfg", "practice"));
    assert.equal(result.normalized.contract.mame.profiles.competition.cfgPath, "cfg/competition");
    assert.equal(result.normalized.contract.mame.profiles.competition.cfgDir, path.join(dir, "cfg", "competition"));
    assert.deepEqual(result.normalized.contract.mame.profiles.competition.launchArgs, [
      "-video",
      "bgfx",
      "-bgfx_screen_chains",
      "crt-geom",
    ]);
  });
});

test("v2 exige campos requeridos", () => {
  const pack = validV2Pack({
    packId: "",
    rom: "",
    weekId: "",
    runtime: {},
  });
  const result = normalizePackContract(pack);

  assert.ok(result.errors.some((item) => /packId/.test(item)));
  assert.ok(result.errors.some((item) => /rom/.test(item)));
  assert.ok(result.errors.some((item) => /weekId/.test(item)));
  assert.ok(result.errors.some((item) => /runtime\.type/.test(item)));
});

test("v2 rechaza runtime distinto de mame", () => {
  const result = normalizePackContract(validV2Pack({
    runtime: {
      type: "dosbox",
      minVersion: "1",
      recommendedVersion: "1",
    },
  }));

  assert.ok(result.errors.some((item) => /runtime\.type debe ser mame/.test(item)));
});

test("v2 rechaza rutas locales inseguras", () => {
  assert.equal(isUnsafePackRelativePath("roms"), false);
  assert.equal(isUnsafePackRelativePath("scripts/space-invaders.lua"), false);
  assert.equal(isUnsafePackRelativePath("../roms"), true);
  assert.equal(isUnsafePackRelativePath("C:/packs/roms"), true);
  assert.equal(isUnsafePackRelativePath("/usr/share/roms"), true);
  assert.equal(isUnsafePackRelativePath("https://example.test/roms"), true);
  assert.equal(isUnsafePackRelativePath("file://C:/roms"), true);

  const romResult = normalizePackContract(validV2Pack({
    mame: {
      ...validV2Pack().mame,
      romPath: "../roms",
    },
  }));
  const adapterResult = normalizePackContract(validV2Pack({
    capture: {
      ...validV2Pack().capture,
      adapter: "C:/scripts/space-invaders.lua",
    },
  }));

  assert.ok(romResult.errors.some((item) => /mame\.romPath/.test(item)));
  assert.ok(adapterResult.errors.some((item) => /capture\.adapter/.test(item)));
});

test("v2 no acepta rutas legacy de MAME embebido", () => {
  const result = normalizePackContract(validV2Pack({
    mame: {
      ...validV2Pack().mame,
      relativeExecutablePath: "mame.exe",
      workingDir: "mame",
    },
  }));

  assert.ok(result.errors.some((item) => /packVersion 2 no acepta mame\.relativeExecutablePath/.test(item)));
});

test("v2 rechaza perfiles MAME inseguros", () => {
  const result = normalizePackContract(validV2Pack({
    mame: {
      ...validV2Pack().mame,
      profiles: {
        competition: {
          cfgPath: "../cfg",
          launchArgs: ["-video", 42],
        },
      },
    },
  }));

  assert.ok(result.errors.some((item) => /mame\.profiles\.competition\.cfgPath/.test(item)));
  assert.ok(result.errors.some((item) => /mame\.profiles\.competition\.launchArgs/.test(item)));
});
