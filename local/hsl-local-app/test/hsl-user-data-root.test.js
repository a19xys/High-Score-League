const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  describeHslUserDataIsolation,
  resolveHslUserDataDir,
} = require("../src/hsl-user-data-root");

test("without HSL_USER_DATA_DIR the HSL root remains the Electron userData root", () => {
  const electronRoot = path.resolve("electron-profile");
  const hslRoot = resolveHslUserDataDir(electronRoot, {});

  assert.equal(hslRoot, electronRoot);
  assert.deepEqual(describeHslUserDataIsolation(electronRoot, hslRoot, {}), {
    electronProfileIsolated: true,
    hslRootMatchesOverride: true,
    overrideActive: false,
    rootsDiffer: false,
  });
});

test("with HSL_USER_DATA_DIR only the HSL root moves", () => {
  const electronRoot = path.resolve("electron-profile");
  const override = path.resolve("isolated-hsl-data");
  const environment = { HSL_USER_DATA_DIR: override };
  const hslRoot = resolveHslUserDataDir(electronRoot, environment);

  assert.equal(hslRoot, override);
  assert.notEqual(hslRoot, electronRoot);
  assert.deepEqual(describeHslUserDataIsolation(electronRoot, hslRoot, environment), {
    electronProfileIsolated: true,
    hslRootMatchesOverride: true,
    overrideActive: true,
    rootsDiffer: true,
  });
});

test("main preserves Electron userData and routes direct HSL consumers to the HSL root", async () => {
  const main = await fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8");

  assert.doesNotMatch(main, /HSL_USER_DATA_DIR[^\n]*app\.setPath|app\.setPath\("userData"/);
  assert.match(main, /const electronUserDataDir = path\.resolve\(app\.getPath\("userData"\)\)/);
  assert.match(main, /const hslUserDataDir = resolveHslUserDataDir\(electronUserDataDir\)/);
  assert.match(main, /configureProductRuntime\(\{[\s\S]*?userDataDir: hslUserDataDir/);
  assert.match(main, /createPresenceService\(\{[\s\S]*?userDataDir: hslUserDataDir/);
  assert.match(main, /createWeekCapabilitiesService\(\{[\s\S]*?userDataDir: hslUserDataDir/);
  assert.match(main, /createThemeAuthority\(\{[\s\S]*?userDataDir: hslUserDataDir/);
  assert.match(main, /resolvePlayerPreferenceScope\(\{ userDataDir: hslUserDataDir \}\)/);
  assert.equal((main.match(/app\.getPath\("userData"\)/g) || []).length, 1);
});
