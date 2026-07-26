const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("main, preload and bootstrap share one effective theme before CSS", () => {
  const main = read("gui/main.js");
  const preload = read("gui/preload.js");
  const bootstrap = read("gui/renderer/theme-bootstrap.js");
  const html = read("gui/renderer/index.html");
  assert.match(main, /createThemeAuthority/);
  assert.match(main, /backgroundColor: themeBackgroundColor\(theme\.effectiveTheme\)/);
  assert.match(main, /--hsl-startup-theme=\$\{theme\.effectiveTheme\}/);
  assert.match(preload, /startupTheme: Object\.freeze/);
  assert.match(bootstrap, /window\.hslLauncher\?\.startupTheme/);
  assert.match(bootstrap, /document\.documentElement\.style\.colorScheme = initialTheme/);
  assert.ok(html.indexOf("theme-bootstrap.js") < html.indexOf("tokens.css"));
});

test("theme persistence failures are classified without rejecting the IPC handler", () => {
  const main = read("gui/main.js");
  const renderer = read("gui/renderer/app.js");
  assert.match(main, /ipcMain\.handle\("launcher:set-theme"[\s\S]*try \{[\s\S]*ok: true[\s\S]*catch \(error\)[\s\S]*ok: false[\s\S]*themePersistenceErrorCode\(error\)/);
  assert.match(renderer, /result\?\.ok === false[\s\S]*THEME_PERSISTENCE_FAILED/);
  assert.match(renderer, /themeToggleQueue = themeToggleQueue\.then/);
});

test("failed renderer legacy migration preserves localStorage for a later retry", () => {
  const main = read("gui/main.js");
  const bootstrap = read("gui/renderer/theme-bootstrap.js");
  assert.match(main, /legacyMigrationStatus = "failed"/);
  assert.match(bootstrap, /resolved\?\.legacyMigrationStatus !== "failed"/);
});

test("the user sees only a two-theme toggle and a manual change never remounts app", () => {
  const renderer = read("gui/renderer/app.js");
  const header = read("gui/renderer/components/header.js");
  const allRenderer = renderer + header + read("gui/renderer/components/copy.js");
  assert.equal((renderer.match(/root\.innerHTML\s*=/g) || []).length, 1);
  assert.match(renderer, /window\.hslLauncher\.setTheme\(theme\)/);
  assert.match(renderer, /store\.setState\(\{ theme: effectiveTheme \}\)/);
  assert.doesNotMatch(allRenderer, />\s*Sistema\s*</i);
  assert.doesNotMatch(read("gui/main.js"), /nativeTheme\.(?:on|addListener)\(/);
});

test("initial state defers remote membership while health and Ranking remain background events", () => {
  const main = read("gui/main.js");
  const readiness = read("gui/renderer/startup-readiness.js");
  assert.match(main, /launcher:get-initial-state[\s\S]*deferRemoteMembership: true/);
  assert.doesNotMatch(readiness, /"health"|"ranking"|"membership"/);
  assert.match(main, /connectivity\.start\("startup"\)\.catch/);
});

test("hero and logo render independent permanent fallbacks and exact identities", async () => {
  const { renderGameVisualRegion } = await import(pathToFileURL(path.join(root, "gui", "renderer", "components", "game-panel.js")));
  const state = {
    data: {
      game: {
        assets: { hero: { url: "file:///hero.png" }, logo: { url: "file:///logo.png" } },
        instanceKey: "A",
        visualAssetGeneration: 7,
      },
      selection: { activeInstanceKey: "A" },
    },
  };
  const html = renderGameVisualRegion(state);
  assert.match(html, /game-panel__placeholder/);
  assert.match(html, /data-asset-kind="hero"/);
  assert.match(html, /data-asset-kind="logo"/);
  assert.equal((html.match(/data-asset-generation="7"/g) || []).length, 2);
  assert.equal((html.match(/data-asset-selection="A"/g) || []).length, 2);
});

test("library cards reserve geometry and provide a per-node definitive fallback", async () => {
  const { renderPackCard } = await import(pathToFileURL(path.join(root, "gui", "renderer", "components", "pack-card.js")));
  const pack = { cover: { url: "file:///cover.png" }, id: "A", instanceKey: "instance-A", status: "ok", title: "Alpha" };
  const state = { busy: false, data: { selection: {}, session: { hasSession: false } } };
  const html = renderPackCard(pack, state, "covers");
  assert.match(html, /pack-card__asset-fallback/);
  assert.match(html, /data-asset-scope="library"/);
  assert.match(html, /data-asset-selection="instance-A"/);
  const css = read("gui/renderer/styles/app.css");
  assert.match(css, /\.pack-card--covers \.pack-card__media[\s\S]*aspect-ratio/);
  assert.match(css, /\.game-hero-stage[\s\S]*aspect-ratio: 1920 \/ 620/);
});

test("asset settlement stays regional and lifecycle cleanup is exhaustive", () => {
  const renderer = read("gui/renderer/app.js");
  assert.match(renderer, /assetIdentityMatches\(image, visualAssetContext\(image\)\)/);
  assert.match(renderer, /visualAssetGeneration/);
  assert.match(renderer, /startupAssetSequence \+= 1/);
  assert.match(renderer, /startupReadiness\.dispose\(\)/);
  assert.match(renderer, /assetPreloader\.dispose\(\)/);
  assert.match(renderer, /removeRendererSubscriptions\.forEach/);
  assert.doesNotMatch(renderer, /function settleVisualAsset[\s\S]{0,900}store\.setState/);
});

test("a recoverable local startup error exposes a real retry action", async () => {
  const { renderLibraryPanel } = await import(pathToFileURL(path.join(root, "gui", "renderer", "components", "library-panel.js")));
  const html = renderLibraryPanel({ initialLoadError: "Estado local no disponible." });
  assert.match(html, /data-action="refresh"/);
  assert.match(html, />Reintentar</);
  const renderer = read("gui/renderer/app.js");
  assert.match(renderer, /if \(action === "refresh"\)/);
  assert.match(renderer, /initialLoadError: null/);
});
