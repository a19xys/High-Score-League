const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const builder = require("../electron-builder.config.cjs");
const { stageProductPlugin } = require("../scripts/stage-product-plugin");
const {
  REQUIRED_RUNTIME_FILES,
  REQUIRED_PLUGIN_FILES,
  verifyProductIntegrityRoot,
  writeProductIntegrityRoot,
  writePluginIntegrityManifest,
  writeRuntimeIntegrityManifest,
} = require("../src/product-runtime-integrity");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-product-root-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, "resources", "mame", "0.287");
  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    const filePath = path.join(runtimeRoot, ...relativePath.split("/"));
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, `runtime:${relativePath}`, "utf8");
  }
  const runtime = await writeRuntimeIntegrityManifest(runtimeRoot, "0.287");
  const pluginRoot = path.join(root, "resources", "hsl", "mame-plugin", "hsl-score");
  const plugin = await stageProductPlugin({ targetDir: pluginRoot });
  const rootPath = path.join(root, "app", "product", "product-integrity-root.json");
  await writeProductIntegrityRoot(rootPath, {
    mameVersion: "0.287",
    pluginVersion: plugin.pluginVersion,
    runtimeManifestPath: runtime.manifestPath,
    pluginManifestPath: plugin.integrity.manifestPath,
  });
  return { pluginRoot, rootPath, runtimeRoot };
}

test("product root lives in ASAR files while mutable runtime remains an extraResource", () => {
  assert.ok(builder.files.some((entry) => entry?.from === ".cache/product"
    && entry?.to === "product" && entry?.filter?.includes("product-integrity-root.json")));
  assert.equal(builder.extraResources.some((entry) => entry?.to === "product/product-integrity-root.json"), false);
});

test("app-controlled root verifies the exact MAME/plugin/CRT closure", async (t) => {
  const value = await fixture(t);
  const verified = await verifyProductIntegrityRoot(value);
  const runtimePaths = new Set(verified.runtime.manifest.files.map((entry) => entry.path));
  for (const relativePath of REQUIRED_RUNTIME_FILES) assert.equal(runtimePaths.has(relativePath), true, relativePath);
});

test("coherently regenerating only the neighboring runtime manifest is blocked", async (t) => {
  const value = await fixture(t);
  await fsp.writeFile(path.join(value.runtimeRoot, "mame.exe"), "replaced-mame", "utf8");
  await writeRuntimeIntegrityManifest(value.runtimeRoot, "0.287");
  await assert.rejects(() => verifyProductIntegrityRoot(value), /manifest vecino del runtime/);
});

test("coherently regenerating only the neighboring plugin manifest is blocked", async (t) => {
  const value = await fixture(t);
  await fsp.appendFile(path.join(value.pluginRoot, "core", "tracking.lua"), "\n-- tamper\n");
  await writePluginIntegrityManifest(value.pluginRoot, "0.4.0", REQUIRED_PLUGIN_FILES);
  await assert.rejects(() => verifyProductIntegrityRoot(value), /manifest vecino del plugin/);
});

test("tampering the root bytes without rebuilding application code is blocked", async (t) => {
  const value = await fixture(t);
  await fsp.appendFile(value.rootPath, " ");
  await assert.rejects(() => verifyProductIntegrityRoot(value), /raiz de integridad de producto/);
});
