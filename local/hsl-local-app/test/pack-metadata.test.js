const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  loadPackMetadata,
  normalizeMetadata,
} = require("../src/pack-metadata");

const METADATA_EXAMPLE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "examples",
  "metadata.hsl-invaders.example.json"
);

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-metadata-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("metadata ausente devuelve fallback sin error", async () => {
  await withTempDir(async (dir) => {
    const result = loadPackMetadata(dir);

    assert.equal(result.loaded, false);
    assert.equal(result.metadata, null);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.metadataPath, path.join(dir, "metadata.json"));
  });
});

test("metadata JSON invalido devuelve warning", async () => {
  await withTempDir(async (dir) => {
    await fsp.writeFile(path.join(dir, "metadata.json"), "{not-json", "utf8");

    const result = loadPackMetadata(dir);

    assert.equal(result.loaded, false);
    assert.equal(result.metadata, null);
    assert.match(result.warnings.join("\n"), /metadata\.json no se pudo leer/);
  });
});

test("metadata valida se normaliza", () => {
  const result = normalizeMetadata({
    title: " Space Invaders ",
    subtitle: " Semana 1 ",
    developer: "Taito",
    publisher: "Taito",
    year: "1978",
    genre: "Arcade",
    shortDescription: "Defiende la Tierra.",
    manual: "manual/manual.html",
    manualPath: "manual/manual.pdf",
    manualUrl: "https://example.test/manual",
    rankingUrl: "https://example.test/ranking",
  }, "C:/pack");

  assert.deepEqual(result.warnings, []);
  assert.equal(result.metadata.title, "Space Invaders");
  assert.equal(result.metadata.subtitle, "Semana 1");
  assert.equal(result.metadata.year, 1978);
  assert.deepEqual(result.metadata.genre, ["Arcade"]);
  assert.equal(result.metadata.shortDescription, "Defiende la Tierra.");
  assert.equal(result.metadata.manual, "manual/manual.html");
  assert.equal(result.metadata.manualPath, "manual/manual.pdf");
});

test("assets relativos se resuelven dentro del pack", async () => {
  await withTempDir(async (dir) => {
    await fsp.mkdir(path.join(dir, "assets"), { recursive: true });
    const heroPath = path.join(dir, "assets", "hero.png");
    const logoPath = path.join(dir, "assets", "logo.svg");
    await fsp.writeFile(heroPath, "png", "utf8");
    await fsp.writeFile(logoPath, "<svg></svg>", "utf8");
    await writeJson(path.join(dir, "metadata.json"), {
      title: "Space Invaders",
      assets: {
        hero: "assets/hero.png",
        logo: "assets/logo.svg",
      },
    });

    const result = loadPackMetadata(dir);

    assert.equal(result.loaded, true);
    assert.equal(result.metadata.assets.hero.fullPath, heroPath);
    assert.equal(result.metadata.assets.hero.url, pathToFileURL(heroPath).href);
    assert.equal(result.metadata.assets.logo.fullPath, logoPath);
    assert.deepEqual(result.warnings, []);
  });
});

test("metadata de referencia de Space Invaders declara assets canonicos", async () => {
  await withTempDir(async (dir) => {
    await fsp.mkdir(path.join(dir, "assets"), { recursive: true });
    await fsp.writeFile(path.join(dir, "assets", "cover.png"), "cover", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "hero.png"), "hero", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "icon.ico"), "icon", "utf8");
    await fsp.writeFile(path.join(dir, "assets", "logo.png"), "logo", "utf8");
    await writeJson(path.join(dir, "metadata.json"), {
      title: "Space Invaders",
      subtitle: "Pack v2 de referencia",
      developer: "Taito",
      publisher: "Taito",
      year: 1978,
      genre: ["Fixed shooter", "Arcade"],
      shortDescription: "El clasico arcade que lo empezo todo.",
      assets: {
        cover: "assets/cover.png",
        hero: "assets/hero.png",
        icon: "assets/icon.ico",
        logo: "assets/logo.png",
      },
    });

    const result = loadPackMetadata(dir);

    assert.equal(result.loaded, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.metadata.title, "Space Invaders");
    assert.equal(result.metadata.assets.cover.relativePath, "assets/cover.png");
    assert.equal(result.metadata.assets.hero.relativePath, "assets/hero.png");
    assert.equal(result.metadata.assets.icon.relativePath, "assets/icon.ico");
    assert.equal(result.metadata.assets.logo.relativePath, "assets/logo.png");
  });
});

test("asset con traversal se rechaza", async () => {
  await withTempDir(async (dir) => {
    await writeJson(path.join(dir, "metadata.json"), {
      title: "Space Invaders",
      assets: {
        hero: "../outside.png",
      },
    });

    const result = loadPackMetadata(dir);

    assert.equal(result.loaded, true);
    assert.equal(result.metadata.assets, undefined);
    assert.match(result.warnings.join("\n"), /no puede salir/);
  });
});

test("asset inexistente genera warning pero no falla", async () => {
  await withTempDir(async (dir) => {
    await writeJson(path.join(dir, "metadata.json"), {
      title: "Space Invaders",
      assets: {
        cover: "assets/cover.jpg",
      },
    });

    const result = loadPackMetadata(dir);

    assert.equal(result.loaded, true);
    assert.equal(result.metadata.title, "Space Invaders");
    assert.equal(result.metadata.assets, undefined);
    assert.match(result.warnings.join("\n"), /no existe en el pack/);
  });
});

test("asset absoluto o remoto se rechaza", async () => {
  await withTempDir(async (dir) => {
    await writeJson(path.join(dir, "metadata.json"), {
      title: "Space Invaders",
      assets: {
        cover: "https://example.test/cover.jpg",
        icon: "C:/packs/icon.png",
      },
    });

    const result = loadPackMetadata(dir);

    assert.equal(result.metadata.assets, undefined);
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings.join("\n"), /ruta relativa dentro del pack/);
  });
});

test("metadata no cambia pack.json ni rutas MAME", async () => {
  await withTempDir(async (dir) => {
    await writeJson(path.join(dir, "metadata.json"), {
      title: "Otro titulo",
      rom: "otra-rom",
      mame: {
        workingDir: "otro-mame",
      },
    });

    const result = loadPackMetadata(dir);

    assert.equal(result.metadata.title, "Otro titulo");
    assert.equal(result.metadata.rom, undefined);
    assert.equal(result.metadata.mame, undefined);
  });
});

test("metadata hsl-invaders example es JSON valido y compatible", async () => {
  const raw = await fsp.readFile(METADATA_EXAMPLE_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const result = normalizeMetadata(parsed, path.dirname(METADATA_EXAMPLE_PATH));

  assert.equal(result.metadata.title, "Space Invaders");
  assert.deepEqual(result.metadata.genre, ["Fixed shooter", "Arcade"]);
  assert.ok(result.warnings.every((warning) => /no existe en el pack/.test(warning)));
});
