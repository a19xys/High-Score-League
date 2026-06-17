const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  getDefaultUserDataDir,
  resolveRuntimePaths,
  resolveUserDataDir,
} = require("../src/runtime-paths");

test("getDefaultUserDataDir resolves Windows APPDATA", () => {
  const dir = getDefaultUserDataDir({
    platform: "win32",
    env: {
      APPDATA: "C:/Users/player/AppData/Roaming",
    },
  });

  assert.equal(dir, path.join("C:/Users/player/AppData/Roaming", "High Score League"));
});

test("getDefaultUserDataDir resolves Linux XDG_DATA_HOME", () => {
  const dir = getDefaultUserDataDir({
    platform: "linux",
    env: {
      XDG_DATA_HOME: "/home/player/.local/share-custom",
    },
  });

  assert.equal(dir, path.join("/home/player/.local/share-custom", "high-score-league"));
});

test("getDefaultUserDataDir falls back to Linux home data dir", () => {
  const dir = getDefaultUserDataDir({
    platform: "linux",
    env: {},
    homeDir: "/home/player",
  });

  assert.equal(dir, path.join("/home/player", ".local", "share", "high-score-league"));
});

test("resolveUserDataDir accepts override", () => {
  const dir = resolveUserDataDir(
    {
      userDataDir: "custom-data",
    },
    {
      appDir: "/tmp/app",
      platform: "linux",
      env: {},
      homeDir: "/home/player",
    }
  );

  assert.equal(dir, path.resolve("/tmp/app", "custom-data"));
});

test("resolveRuntimePaths resolves MAME paths from pack metadata", () => {
  const paths = resolveRuntimePaths(
    {},
    {
      packRoot: "/tmp/pack",
      mame: {
        relativeExecutablePath: "mame/mame.exe",
        workingDir: "mame",
        pluginName: "hsl-score",
      },
    },
    {
      appDir: "/tmp/pack/hsl-local-app",
      platform: "linux",
      env: {},
      homeDir: "/home/player",
    }
  );

  assert.equal(paths.mame.executablePath, path.resolve("/tmp/pack", "mame/mame.exe"));
  assert.equal(paths.mame.workingDir, path.resolve("/tmp/pack", "mame"));
  assert.equal(paths.mame.pluginName, "hsl-score");
});
