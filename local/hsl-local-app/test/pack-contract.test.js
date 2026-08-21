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
      adapter: "scripts/invaders.lua",
    },
    ...overrides,
  };
}

function integrityV1(dips = [
  { portTag: ":IN2", mask: 8, value: 0, label: "Bonus Life", settingLabel: "1500" },
  { portTag: ":IN2", mask: 3, value: 0, label: "Lives", settingLabel: "3" },
]) {
  return { version: 1, mameVersion: "0.287", dips };
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
    assert.equal(result.normalized.contract.capture.adapter, "scripts/invaders.lua");
    assert.equal(result.normalized.contract.capture.adapterPath, path.join(dir, "scripts", "invaders.lua"));
    assert.equal(result.normalized.contract.mame.profiles.competition.integrity, null);
  });
});

test("v2 acepta el pack de referencia de Space Invaders con perfil competitivo crt-geom", async () => {
  await withTempDir(async (dir) => {
    const result = normalizePackContract(validV2Pack({
      packId: "space-invaders-dev-pack-v2",
      seasonId: "16da66c8-9267-48ea-b8b5-faea5f1d481c",
      seasonSlug: "temporada-test",
      seasonName: "Temporada Test",
      weekId: "7e8576e0-cab6-495c-9030-8e405d31dcad",
      mame: {
        ...validV2Pack().mame,
        profiles: {
          practice: {
            launchArgs: [],
          },
          competition: {
            launchArgs: ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"],
            integrity: integrityV1(),
          },
        },
      },
    }), {
      packRoot: dir,
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.normalized.packId, "space-invaders-dev-pack-v2");
    assert.equal(result.normalized.contract.capture.adapter, "scripts/invaders.lua");
    assert.equal(result.normalized.contract.mame.profiles.practice.cfgPath, null);
    assert.deepEqual(result.normalized.contract.mame.profiles.practice.launchArgs, []);
    assert.equal(result.normalized.contract.mame.profiles.competition.cfgPath, null);
    assert.deepEqual(result.normalized.contract.mame.profiles.competition.integrity.dips.map((dip) => [dip.portTag, dip.mask]), [
      [":IN2", 3],
      [":IN2", 8],
    ]);
    assert.deepEqual(result.normalized.contract.mame.profiles.competition.launchArgs, [
      "-video",
      "bgfx",
      "-bgfx_screen_chains",
      "crt-geom",
    ]);
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
  assert.equal(isUnsafePackRelativePath("scripts/invaders.lua"), false);
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

test("integrity v1 es compatible-opcional, valida limites y canonicaliza DIP", () => {
  const legacy = normalizePackContract(validV2Pack());
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.normalized.contract.mame.profiles.competition.integrity, null);

  const valid = normalizePackContract(validV2Pack({
    mame: {
      ...validV2Pack().mame,
      profiles: { competition: { integrity: integrityV1() } },
    },
  }));
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.normalized.contract.mame.profiles.competition.integrity.dips.map((dip) => dip.mask), [3, 8]);

  for (const [name, integrity, pattern] of [
    ["version", { ...integrityV1(), version: 2 }, /version debe ser exactamente 1/],
    ["mameVersion", { ...integrityV1(), mameVersion: "" }, /mameVersion/],
    ["mameVersion exacta", { ...integrityV1(), mameVersion: "MAME 0.287" }, /version MAME exacta/],
    ["campo integrity desconocido", { ...integrityV1(), trusted: true }, /campos desconocidos/],
    ["empty dips", { ...integrityV1(), dips: [] }, /array no vacio/],
    ["mask zero", integrityV1([{ portTag: ":IN2", mask: 0, value: 0, label: "Lives", settingLabel: "3" }]), /mask/],
    ["mask 33bit", integrityV1([{ portTag: ":IN2", mask: 0x100000000, value: 0, label: "Lives", settingLabel: "3" }]), /mask/],
    ["outside mask", integrityV1([{ portTag: ":IN2", mask: 3, value: 8, label: "Lives", settingLabel: "3" }]), /fuera de mask/],
    ["duplicate", integrityV1([
      { portTag: ":IN2", mask: 3, value: 0, label: "Lives", settingLabel: "3" },
      { portTag: ":IN2", mask: 3, value: 0, label: "Lives", settingLabel: "3" },
    ]), /duplica/],
    ["control label", integrityV1([{ portTag: ":IN2", mask: 3, value: 0, label: "Lives\n", settingLabel: "3" }]), /label/],
    ["campo DIP desconocido", integrityV1([{ portTag: ":IN2", mask: 3, value: 0, label: "Lives", settingLabel: "3", path: "private" }]), /campos desconocidos/],
  ]) {
    const result = normalizePackContract(validV2Pack({
      mame: { ...validV2Pack().mame, profiles: { competition: { integrity } } },
    }));
    assert.match(result.errors.join("\n"), pattern, name);
  }

  const practice = normalizePackContract(validV2Pack({
    mame: { ...validV2Pack().mame, profiles: { practice: { integrity: integrityV1() } } },
  }));
  assert.match(practice.errors.join("\n"), /practice\.integrity no esta permitido/);
});
