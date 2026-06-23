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

test("loadConfig resolves explicit queue paths and legacy default session path", async () => {
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

test("loadConfig derives queue paths from eventsBaseDir", async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "config.json");
    await fsp.writeFile(
      configPath,
      JSON.stringify({
        eventsBaseDir: "userData/events",
        userDataDir: path.join(dir, "user-data"),
      }),
      "utf8"
    );

    const config = loadConfig(configPath, dir);

    assert.equal(config.eventsPendingDirAbs, path.join(dir, "user-data", "events", "pending"));
    assert.equal(config.eventsSentDirAbs, path.join(dir, "user-data", "events", "sent"));
    assert.equal(config.eventsFailedDirAbs, path.join(dir, "user-data", "events", "failed"));
    assert.equal(config.eventsSource, "eventsBaseDir");
  });
});

test("loadConfig uses userData events when no event paths are configured", async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "missing-config.json");

    const config = loadConfig(configPath, dir);

    assert.equal(config.configSource, "defaults");
    assert.match(config.eventsPendingDirAbs, /events[\\/]pending$/);
    assert.equal(config.eventsSource, "userData");
  });
});

test("loadConfig gives explicit event dirs priority over eventsBaseDir", async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "config.json");
    await fsp.writeFile(
      configPath,
      JSON.stringify({
        eventsBaseDir: "userData/events",
        eventsPendingDir: "legacy/pending",
        eventsSentDir: "legacy/sent",
        eventsFailedDir: "legacy/failed",
        userDataDir: path.join(dir, "user-data"),
      }),
      "utf8"
    );

    const config = loadConfig(configPath, dir);

    assert.equal(config.eventsPendingDirAbs, path.resolve(dir, "legacy/pending"));
    assert.equal(config.eventsSentDirAbs, path.resolve(dir, "legacy/sent"));
    assert.equal(config.eventsFailedDirAbs, path.resolve(dir, "legacy/failed"));
    assert.equal(config.eventsSource, "explicit");
  });
});

test("loadConfig resolves sessionFile inside userData", async () => {
  await withTempDir(async (dir) => {
    const configPath = path.join(dir, "config.json");
    await fsp.writeFile(
      configPath,
      JSON.stringify({
        userDataDir: path.join(dir, "user-data"),
        sessionFile: "userData/session.json",
      }),
      "utf8"
    );

    const config = loadConfig(configPath, dir);

    assert.equal(config.sessionFileAbs, path.join(dir, "user-data", "session.json"));
  });
});

test("loadConfig reads shared MAME runtime state from userData", async () => {
  await withTempDir(async (dir) => {
    const userDataDir = path.join(dir, "user-data");
    const mamePath = path.join(dir, "runtime", "mame.exe");
    const configPath = path.join(dir, "config.json");
    await fsp.mkdir(path.dirname(mamePath), { recursive: true });
    await fsp.mkdir(path.join(userDataDir, "runtime"), { recursive: true });
    await fsp.writeFile(mamePath, "binary", "utf8");
    await fsp.writeFile(
      path.join(userDataDir, "runtime", "mame-runtime.json"),
      JSON.stringify({
        schemaVersion: 1,
        mameExecutablePath: mamePath,
        selectedAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      }),
      "utf8"
    );
    await fsp.writeFile(configPath, JSON.stringify({ userDataDir }), "utf8");

    const config = loadConfig(configPath, dir);

    assert.equal(config.sharedMameRuntime.configured, true);
    assert.equal(config.sharedMameRuntime.available, true);
    assert.equal(config.sharedMameRuntime.mameExecutablePath, mamePath);
  });
});
