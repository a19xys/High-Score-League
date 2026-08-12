const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_BROWSERWINDOW_TESTS === "1";

test("BrowserWindow cambia identidad, Biblioteca y tema en un unico flujo A -> B", { skip: !enabled, timeout: 120_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "preferences",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());

  assert.deepEqual(result.initial, {
    account: "fixture@example.test. Sesión activa",
    busy: false,
    direction: "desc",
    sidebar: 560,
    sort: "title",
    theme: "dark",
    view: "covers",
  });
  assert.deepEqual(result.b, {
    account: "valid@example.test. Sesión activa",
    busy: false,
    direction: "asc",
    sidebar: 360,
    sort: "weeks",
    theme: "light",
    view: "icons",
  });
  assert.equal(result.sameScopeAfterStale.view, "covers");
  assert.equal(result.sameScopeAfterStale.account, result.b.account);
  assert.deepEqual(result.requiresLogin, result.initial);
  assert.deepEqual(result.failedSwitch, result.initial);
  assert.deepEqual(result.restoredA, result.initial);
  assert.deepEqual(result.global, {
    account: "Sin sesión. No has iniciado sesión",
    busy: false,
    direction: "asc",
    sidebar: 440,
    sort: "developer",
    theme: "dark",
    view: "list",
  });
  assert.deepEqual(result.reloginA, result.initial);
  assert.deepEqual(result.forgetInactive, result.initial);
  assert.deepEqual(result.forgetActive, result.b);
  assert.match(result.raceBeforeRelease.account, /fixture@example\.test/);
  assert.equal(result.raceBeforeRelease.view, "list");
  assert.equal(result.raceBeforeRelease.busy, true);
  assert.deepEqual(result.raceAfterRelease, result.b);
  assert.equal(result.raceWrites.length, 1);
  assert.deepEqual(result.raceWrites[0], {
    librarySortBy: "title",
    librarySortDirection: "desc",
    libraryView: "list",
    scopeKey: "player:user_fixture",
    sidebarWidth: 560,
  });
  for (const frame of result.toBTrace) {
    if (!frame.account.includes("valid@example.test")) continue;
    assert.deepEqual(
      [frame.view, frame.sort, frame.direction, frame.sidebar, frame.theme],
      ["icons", "weeks", "asc", 360, "light"],
    );
  }
  for (const frame of result.toATrace) {
    if (!frame.account.includes("fixture@example.test")) continue;
    assert.deepEqual(
      [frame.view, frame.sort, frame.direction, frame.sidebar, frame.theme],
      ["covers", "title", "desc", 560, "dark"],
    );
  }
});
