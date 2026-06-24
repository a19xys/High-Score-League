const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const LOCAL_ROOT = path.resolve(__dirname, "..", "..");

test("legacy plan cubre elementos compatibles y su reemplazo", async () => {
  const plan = await fsp.readFile(
    path.join(LOCAL_ROOT, "docs", "legacy-deprecation-plan.md"),
    "utf8"
  );

  for (const item of [
    "packVersion: 1",
    "mame.relativeExecutablePath",
    "mame.workingDir",
    "resolvePackMamePaths",
    "sync-plugin",
    "locations.json",
    "Dev bridge temporal",
    "MAME embebido en pack",
  ]) {
    assert.match(plan, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  assert.match(plan, /packVersion: 2/);
  assert.match(plan, /LOCAL-REMOVE-PACK-V1-LEGACY/);
  assert.match(plan, /LOCAL-MAME-PACK-PLUGIN-LOADING-2/);
});

test("helpers legacy mantienen marcadores deprecated sin eliminar compatibilidad", async () => {
  const [pack, plugin, locations, service] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "src", "pack.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "src", "dev-sync-plugin.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "src", "library-locations.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
  ]);

  assert.match(pack, /@deprecated[\s\S]*resolvePackMamePaths/);
  assert.match(plugin, /@deprecated[\s\S]*syncPluginToPack/);
  assert.match(locations, /@deprecated[\s\S]*locations\.json/);
  assert.match(service, /@deprecated[\s\S]*async function syncPlugin/);
});
