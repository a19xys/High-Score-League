const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  getSharedMameRuntimeFile,
  readSharedMameRuntime,
  writeSharedMameRuntime,
} = require("../src/shared-mame-runtime");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-shared-mame-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function config(root) {
  return {
    userDataDir: path.join(root, "userData"),
  };
}

test("runtime ausente devuelve estado no configurado", async () => {
  await withTempDir(async (dir) => {
    const state = readSharedMameRuntime(config(dir));

    assert.equal(state.configured, false);
    assert.equal(state.available, false);
    assert.equal(state.runtimeFile, path.join(dir, "userData", "runtime", "mame-runtime.json"));
  });
});

test("JSON corrupto no crashea y devuelve warning", async () => {
  await withTempDir(async (dir) => {
    const runtimeFile = getSharedMameRuntimeFile(config(dir));
    await fsp.mkdir(path.dirname(runtimeFile), { recursive: true });
    await fsp.writeFile(runtimeFile, "{", "utf8");

    const state = readSharedMameRuntime(config(dir));

    assert.equal(state.configured, false);
    assert.ok(state.warnings.some((item) => /JSON valido/.test(item)));
  });
});

test("guardar ruta crea mame-runtime.json y normaliza ruta", async () => {
  await withTempDir(async (dir) => {
    const mamePath = path.join(dir, "runtime", "mame.exe");
    await fsp.mkdir(path.dirname(mamePath), { recursive: true });
    await fsp.writeFile(mamePath, "binary", "utf8");

    const state = await writeSharedMameRuntime(config(dir), mamePath, {
      selectedAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    const raw = JSON.parse(await fsp.readFile(getSharedMameRuntimeFile(config(dir)), "utf8"));

    assert.equal(state.configured, true);
    assert.equal(state.available, true);
    assert.equal(state.mameExecutablePath, mamePath);
    assert.equal(raw.mameExecutablePath, mamePath);
    assert.equal(JSON.stringify(raw).includes("access_token"), false);
  });
});

test("ruta inexistente queda configurada pero no disponible", async () => {
  await withTempDir(async (dir) => {
    const missing = path.join(dir, "runtime", "mame.exe");
    const state = await writeSharedMameRuntime(config(dir), missing);

    assert.equal(state.configured, true);
    assert.equal(state.available, false);
    assert.equal(state.exists, false);
    assert.ok(state.errors.some((item) => /No se encontro mame\.exe/.test(item)));
  });
});

test("ruta a carpeta se reporta como no disponible", async () => {
  await withTempDir(async (dir) => {
    const folder = path.join(dir, "runtime", "mame.exe");
    await fsp.mkdir(folder, { recursive: true });

    const state = await writeSharedMameRuntime(config(dir), folder);

    assert.equal(state.configured, true);
    assert.equal(state.available, false);
    assert.equal(state.exists, true);
    assert.equal(state.isFile, false);
    assert.ok(state.errors.some((item) => /no es un archivo/.test(item)));
  });
});
