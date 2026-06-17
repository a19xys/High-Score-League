const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { getBoxDir, loadConfig, resolveFromAppDir } = require("../src/config");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-config-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("resolveFromAppDir keeps absolute paths and resolves relative paths", async () => {
  await withTempDir(async (dir) => {
    const absolute = path.join(dir, "events");

    assert.equal(resolveFromAppDir(absolute, dir), absolute);
    assert.equal(resolveFromAppDir("../events", dir), path.resolve(dir, "../events"));
  });
});

test("loadConfig resolves queue paths and default session path", async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "config.json");
    await fsp.writeFile(
      configPath,
      JSON.stringify({
        eventsPendingDir: "../mame-plugin/hsl-score/events/pending",
        eventsSentDir: "../mame-plugin/hsl-score/events/sent",
        eventsFailedDir: "../mame-plugin/hsl-score/events/failed",
      }),
      "utf8"
    );

    const config = loadConfig(configPath, dir);

    assert.equal(config.eventsPendingDirAbs, path.resolve(dir, "../mame-plugin/hsl-score/events/pending"));
    assert.equal(config.eventsSentDirAbs, path.resolve(dir, "../mame-plugin/hsl-score/events/sent"));
    assert.equal(config.eventsFailedDirAbs, path.resolve(dir, "../mame-plugin/hsl-score/events/failed"));
    assert.equal(config.sessionFileAbs, path.resolve(dir, ".hsl-session.json"));
    assert.equal(getBoxDir(config, "pending"), config.eventsPendingDirAbs);
  });
});

test("loadConfig requires eventsPendingDir", async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "config.json");
    await fsp.writeFile(configPath, JSON.stringify({}), "utf8");

    assert.throws(() => loadConfig(configPath, dir), /eventsPendingDir/);
  });
});
