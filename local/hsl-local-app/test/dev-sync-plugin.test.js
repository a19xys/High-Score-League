const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  SYNC_PLUGIN_CONFIG_ERROR,
  getConfiguredPackPluginDir,
  getRepoPluginDir,
  listPluginFilesToCopy,
  syncPluginToPack,
} = require("../src/dev-sync-plugin");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-sync-plugin-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function writeFile(filePath, content = "test") {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function createSourcePlugin(root) {
  const sourceDir = path.join(root, "repo", "local", "mame-plugin", "hsl-score");

  await writeFile(path.join(sourceDir, "init.lua"), "init");
  await writeFile(path.join(sourceDir, "plugin.json"), "{\"plugin\":\"hsl-score\"}");
  await writeFile(path.join(sourceDir, "config.example.lua"), "example");
  await writeFile(path.join(sourceDir, "config.lua"), "local config");
  await writeFile(path.join(sourceDir, "core", "writer.lua"), "writer");
  await writeFile(path.join(sourceDir, "core", "nested", "helper.lua"), "helper");
  await writeFile(path.join(sourceDir, "games", "invaders.lua"), "game");
  await writeFile(path.join(sourceDir, "events", "pending", "score.json"), "{}");
  await writeFile(path.join(sourceDir, "events", "failed", "score.txt"), "failed");

  return sourceDir;
}

async function createPack(root) {
  const workingDir = path.join(root, "pack");
  const targetDir = path.join(workingDir, "plugins", "hsl-score");

  await fsp.mkdir(workingDir, { recursive: true });
  await writeFile(path.join(targetDir, "config.lua"), "pack config");
  await writeFile(path.join(targetDir, "events", "pending", "existing.json"), "{\"score\":100}");

  return {
    config: {
      mame: {
        workingDir,
        pluginName: "hsl-score",
      },
    },
    targetDir,
    workingDir,
  };
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorPattern() {
  return new RegExp(SYNC_PLUGIN_CONFIG_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("getRepoPluginDir resolves plugin source from local app dir", () => {
  const appDir = path.join("C:", "repo", "local", "hsl-local-app");

  assert.equal(
    getRepoPluginDir(appDir),
    path.resolve(appDir, "..", "mame-plugin", "hsl-score")
  );
});

test("getConfiguredPackPluginDir resolves destination from MAME config", () => {
  const config = {
    mame: {
      workingDir: "C:/packs/hsl-invaders",
      pluginName: "hsl-score",
    },
  };

  assert.equal(
    getConfiguredPackPluginDir(config),
    path.join("C:/packs/hsl-invaders", "plugins", "hsl-score")
  );
});

test("listPluginFilesToCopy includes only versioned plugin source files", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createSourcePlugin(dir);
    const files = await listPluginFilesToCopy(sourceDir);

    assert.ok(files.includes("init.lua"));
    assert.ok(files.includes("plugin.json"));
    assert.ok(files.includes("config.example.lua"));
    assert.ok(files.includes(path.join("core", "writer.lua")));
    assert.ok(files.includes(path.join("core", "nested", "helper.lua")));
    assert.ok(files.includes(path.join("games", "invaders.lua")));
    assert.equal(files.includes("config.lua"), false);
    assert.equal(files.includes(path.join("events", "pending", "score.json")), false);
    assert.equal(files.includes(path.join("events", "failed", "score.txt")), false);
  });
});

test("syncPluginToPack copies plugin source and preserves local pack files", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createSourcePlugin(dir);
    const { config, targetDir } = await createPack(dir);

    const result = await syncPluginToPack(config, { sourceDir });

    assert.equal(result.dryRun, false);
    assert.ok(await fileExists(path.join(targetDir, "init.lua")));
    assert.ok(await fileExists(path.join(targetDir, "plugin.json")));
    assert.ok(await fileExists(path.join(targetDir, "config.example.lua")));
    assert.ok(await fileExists(path.join(targetDir, "core", "writer.lua")));
    assert.ok(await fileExists(path.join(targetDir, "games", "invaders.lua")));
    assert.equal(await fsp.readFile(path.join(targetDir, "config.lua"), "utf8"), "pack config");
    assert.equal(await fsp.readFile(path.join(targetDir, "events", "pending", "existing.json"), "utf8"), "{\"score\":100}");
    assert.equal(await fileExists(path.join(targetDir, "events", "pending", "score.json")), false);
  });
});

test("syncPluginToPack creates plugin target folder but not a missing pack", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createSourcePlugin(dir);
    const workingDir = path.join(dir, "pack");
    const targetDir = path.join(workingDir, "plugins", "hsl-score");

    await fsp.mkdir(workingDir, { recursive: true });
    await syncPluginToPack({ mame: { workingDir, pluginName: "hsl-score" } }, { sourceDir });

    assert.ok(await fileExists(path.join(targetDir, "init.lua")));
  });
});

test("syncPluginToPack dry-run does not modify destination", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createSourcePlugin(dir);
    const { config, targetDir } = await createPack(dir);
    const beforeConfig = await fsp.readFile(path.join(targetDir, "config.lua"), "utf8");

    const result = await syncPluginToPack(config, { sourceDir, dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(await fsp.readFile(path.join(targetDir, "config.lua"), "utf8"), beforeConfig);
    assert.equal(await fileExists(path.join(targetDir, "init.lua")), false);
    assert.equal(await fileExists(path.join(targetDir, "plugin.json")), false);
  });
});

test("syncPluginToPack fails clearly when mame.workingDir is missing", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createSourcePlugin(dir);

    await assert.rejects(
      () => syncPluginToPack({ mame: { pluginName: "hsl-score" } }, { sourceDir }),
      errorPattern()
    );
  });
});

test("syncPluginToPack fails clearly when mame.pluginName is missing", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = await createSourcePlugin(dir);

    await assert.rejects(
      () => syncPluginToPack({ mame: { workingDir: dir } }, { sourceDir }),
      errorPattern()
    );
  });
});
