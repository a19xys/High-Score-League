const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  resolvePackManual,
  resolvePackRanking,
  toRendererContentState,
} = require("../src/pack-content");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-pack-content-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("manual/manual.html se detecta dentro del pack", async () => {
  await withTempDir(async (dir) => {
    const manualPath = path.join(dir, "manual", "manual.html");
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "<html></html>", "utf8");

    const result = resolvePackManual({ packRoot: dir });

    assert.equal(result.available, true);
    assert.equal(result.kind, "local");
    assert.equal(result.path, manualPath);
    assert.equal(result.relativePath, "manual/manual.html");
  });
});

test("manual/manual.pdf se detecta dentro del pack", async () => {
  await withTempDir(async (dir) => {
    const manualPath = path.join(dir, "manual", "manual.pdf");
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "pdf", "utf8");

    const result = resolvePackManual({ packRoot: dir });

    assert.equal(result.available, true);
    assert.equal(result.path, manualPath);
  });
});

test("manual/invaders.pdf se detecta si es el unico PDF en manual", async () => {
  await withTempDir(async (dir) => {
    const manualPath = path.join(dir, "manual", "invaders.pdf");
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "pdf", "utf8");

    const result = resolvePackManual({ packRoot: dir });

    assert.equal(result.available, true);
    assert.equal(result.path, manualPath);
    assert.equal(result.relativePath, "manual/invaders.pdf");
    assert.equal(result.source, "manual/*.pdf");
  });
});

test("metadata.manualPath relativo se detecta", async () => {
  await withTempDir(async (dir) => {
    const manualPath = path.join(dir, "docs", "guide.pdf");
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "pdf", "utf8");

    const result = resolvePackManual({
      metadata: { manualPath: "docs/guide.pdf" },
      packRoot: dir,
    });

    assert.equal(result.available, true);
    assert.equal(result.source, "metadata.manualPath");
  });
});

test("metadata.manual.path relativo se detecta", async () => {
  await withTempDir(async (dir) => {
    const manualPath = path.join(dir, "docs", "guide.html");
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "<html></html>", "utf8");

    const result = resolvePackManual({
      metadata: { manual: { path: "docs/guide.html" } },
      packRoot: dir,
    });

    assert.equal(result.available, true);
    assert.equal(result.source, "metadata.manual.path");
  });
});

test("manual local rechaza traversal, ruta absoluta y file URL", async () => {
  await withTempDir(async (dir) => {
    for (const manualPath of ["../manual.pdf", path.join(dir, "manual.pdf"), "file:///tmp/manual.pdf"]) {
      const result = resolvePackManual({
        metadata: { manualPath },
        packRoot: dir,
      });

      assert.equal(result.available, false);
      assert.match(result.reason, /seguro dentro del pack/);
    }
  });
});

test("manual unico ambiguo exige declaracion explicita", async () => {
  await withTempDir(async (dir) => {
    await fsp.mkdir(path.join(dir, "manual"), { recursive: true });
    await fsp.writeFile(path.join(dir, "manual", "a.pdf"), "pdf", "utf8");
    await fsp.writeFile(path.join(dir, "manual", "b.pdf"), "pdf", "utf8");

    const result = resolvePackManual({ packRoot: dir });

    assert.equal(result.available, false);
    assert.match(result.reason, /varios manuales/i);
  });
});

test("manualUrl acepta solo URL http explicita", () => {
  const valid = resolvePackManual({
    metadata: { manualUrl: "https://example.test/manual" },
    packRoot: "C:/pack",
  });
  const invalid = resolvePackManual({
    metadata: { manualUrl: "file:///C:/manual.pdf" },
    packRoot: "C:/pack",
  });

  assert.equal(valid.available, true);
  assert.equal(valid.kind, "external");
  assert.equal(invalid.available, false);
});

test("pack sin manual devuelve mensaje amable y estado renderer sin rutas", () => {
  const target = resolvePackManual({ packRoot: "C:/missing-pack" });
  const renderer = toRendererContentState(target);

  assert.equal(target.available, false);
  assert.match(target.reason, /todavia no incluye manual local/);
  assert.deepEqual(renderer, {
    available: false,
    kind: "missing",
    reason: target.reason,
    source: null,
  });
  assert.equal(Object.hasOwn(renderer, "path"), false);
  assert.equal(Object.hasOwn(renderer, "url"), false);
});

test("ranking usa metadata.rankingUrl cuando existe", () => {
  const result = resolvePackRanking({
    metadata: { rankingUrl: "https://example.test/ranking/week-1" },
  });

  assert.equal(result.available, true);
  assert.equal(result.url, "https://example.test/ranking/week-1");
  assert.equal(result.source, "metadata.rankingUrl");
});

test("ranking usa ruta web de weekId como fallback claro", () => {
  const result = resolvePackRanking({
    webBaseUrl: "https://high-score-league.example",
    weekId: "week 1",
  });

  assert.equal(result.available, true);
  assert.equal(result.source, "week-web-route");
  assert.equal(result.url, "https://high-score-league.example/weeks/week%201");
});

test("ranking usa temporada si no hay weekId", () => {
  const result = resolvePackRanking({
    seasonSlug: "temporada-test",
    webBaseUrl: "https://high-score-league.example",
  });

  assert.equal(result.available, true);
  assert.equal(result.source, "season-web-route");
  assert.equal(result.url, "https://high-score-league.example/seasons/temporada-test");
});

test("ranking usa webBaseUrl como fallback seguro", () => {
  const result = resolvePackRanking({
    webBaseUrl: "https://high-score-league.example",
  });

  assert.equal(result.available, true);
  assert.equal(result.source, "web-base-url");
  assert.equal(result.url, "https://high-score-league.example");
});

test("ranking sin URL valida no inventa endpoint", () => {
  const result = resolvePackRanking({}, null);

  assert.equal(result.available, false);
  assert.match(result.reason, /Ranking integrado pendiente/);
});
