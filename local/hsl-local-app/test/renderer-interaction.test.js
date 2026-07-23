const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const appDir = path.join(__dirname, "..", "gui", "renderer");
const source = (relativePath) => fs.readFileSync(path.join(appDir, relativePath), "utf8");

function rendererState(patch = {}) {
  const pack = {
    favorite: false,
    favoriteKey: "pack-a",
    instanceKey: "instance-a",
    packId: "pack-a",
    seasonId: "season-a",
    seasonName: "Season A",
    status: "ready",
    title: "Game A",
    weekId: "week-a",
    year: "1984",
  };
  const state = {
    accountMenuOpen: false,
    authEmail: "",
    authError: null,
    authFormOpen: false,
    busy: false,
    connectivity: { reachability: "connected", reachabilityGeneration: 1 },
    data: {
      accounts: { knownAccounts: [{ email: "player@example.test", initials: "PE", isActive: true, userId: "player" }] },
      autoSync: { status: "idle" },
      bridge: {},
      game: {
        assets: { hero: { url: "file:///hero.png" }, logo: { url: "file:///logo.png" } },
        displayName: "Game A",
        instanceKey: "instance-a",
        manual: { available: true },
        packId: "pack-a",
        weekId: "week-a",
        year: "1984",
      },
      library: {
        directory: { available: true, configured: true, path: "C:/packs" },
        packs: [pack],
        status: "available-populated",
        totals: { packs: 1 },
      },
      membership: { canPlayCompetition: true, status: "member" },
      queue: { totals: { failed: 0, pending: 0, sent: 0 } },
      readiness: { canPlayCompetition: true, canPractice: true, status: "ready" },
      remoteConfiguration: { status: "configured" },
      selection: { activeInstanceKey: "instance-a" },
      session: { email: "player@example.test", hasSession: true, userId: "player" },
    },
    libraryFavoriteFilter: "all",
    libraryFiltersOpen: true,
    libraryQuery: "",
    librarySeason: "all",
    librarySortBy: "weeks",
    librarySortDirection: "asc",
    libraryStatus: "all",
    libraryView: "covers",
    rankingCapabilities: {
      entries: { "week-a": { status: "available", url: "https://hsl.test/ranking", weekId: "week-a" } },
      webBaseUrl: "https://hsl.test",
    },
    rankingOpening: false,
    theme: "dark",
  };

  return { ...state, ...patch };
}

async function modules() {
  return Promise.all([
    import(pathToFileURL(path.join(appDir, "region-renderer.js"))),
    import(pathToFileURL(path.join(appDir, "components", "header.js"))),
    import(pathToFileURL(path.join(appDir, "components", "library-panel.js"))),
    import(pathToFileURL(path.join(appDir, "components", "game-panel.js"))),
  ]);
}

function fakeRenderer(createRegionRenderer, names) {
  const regions = new Map(names.map((name) => [name, { html: "", identity: Symbol(name), writes: 0 }]));
  const renderer = createRegionRenderer({
    findRegion: (name) => regions.get(name),
    writeRegion(region, html) {
      region.html = html;
      region.identity = Symbol("replacement");
      region.writes += 1;
    },
  });
  return { regions, renderer };
}

test("connectivity does not replace the library search input", async () => {
  const [{ createRegionRenderer }, , { renderLibraryControls }] = await modules();
  const initial = rendererState();
  const { regions, renderer } = fakeRenderer(createRegionRenderer, ["library-controls"]);
  const html = renderLibraryControls(initial, initial.data.library.packs);
  renderer.prime("library-controls", html);
  const identity = regions.get("library-controls").identity;
  const offline = rendererState({ connectivity: { reachability: "offline", reachabilityGeneration: 2 } });
  renderer.render("library-controls", renderLibraryControls(offline, offline.data.library.packs));
  assert.equal(regions.get("library-controls").identity, identity);
});

test("Ranking only invalidates game actions, not the library toolbar", async () => {
  const [, , { renderLibraryControls }, { renderGameActionsRegion }] = await modules();
  const initial = rendererState();
  const checking = rendererState({ rankingCapabilities: { entries: {}, webBaseUrl: "https://hsl.test" } });
  assert.equal(renderLibraryControls(initial, initial.data.library.packs), renderLibraryControls(checking, checking.data.library.packs));
  assert.notEqual(renderGameActionsRegion(initial), renderGameActionsRegion(checking));
});

test("preference persistence does not unmount an unchanged active select", async () => {
  const [{ createRegionRenderer }, , { renderLibraryControls }] = await modules();
  const initial = rendererState();
  const persisted = rendererState({ data: { ...initial.data, library: { ...initial.data.library, preferences: { sortBy: "weeks" } } } });
  const { regions, renderer } = fakeRenderer(createRegionRenderer, ["library-controls"]);
  const html = renderLibraryControls(initial, initial.data.library.packs);
  renderer.prime("library-controls", html);
  const identity = regions.get("library-controls").identity;
  renderer.render("library-controls", renderLibraryControls(persisted, persisted.data.library.packs));
  assert.equal(regions.get("library-controls").identity, identity);
});

test("the account menu survives an unrelated Ranking event", async () => {
  const [, { renderAccountControl }] = await modules();
  const open = rendererState({ accountMenuOpen: true });
  const ranking = rendererState({ accountMenuOpen: true, rankingCapabilities: { entries: {}, stateSequence: 4 } });
  assert.equal(renderAccountControl(open), renderAccountControl(ranking));
});

test("logout and real account switch close the account menu", () => {
  const app = source("app.js");
  assert.match(app, /action === "switch-account"[\s\S]*closeAccountMenuState\(\)/);
  assert.match(app, /action === "logout"[\s\S]*runAction/);
  assert.match(app, /async function runAction[\s\S]*closeAccountMenuState\(\)/);
});

test("sidebar resize has a render fast path and does not rebuild the shell", () => {
  const app = source("app.js");
  assert.match(app, /changedKeys\.length === 1 && changedKeys\[0\] === "librarySidebarWidth"/);
  assert.equal((app.match(/root\.innerHTML\s*=/g) || []).length, 1);
});

test("library scroll container has persistent identity", () => {
  const app = source("app.js");
  assert.match(source(path.join("components", "library-panel.js")), /class="library-section library-section--packs" data-render-region="library-packs"/);
  assert.doesNotMatch(app, /function readMainScrollState/);
});

test("detail scroll remains mounted for updates to the same pack", () => {
  const app = source("app.js");
  assert.match(app, /class="game-scroll" data-render-region="game-panel"/);
  assert.match(app, /nextGameStructureKey !== currentGameStructureKey/);
});

test("changing pack resets only detail scroll", () => {
  const app = source("app.js");
  assert.match(app, /currentDetailScrollKey && nextDetailScrollKey !== currentDetailScrollKey/);
  assert.match(app, /gameScroll\.scrollTop = 0/);
  assert.doesNotMatch(app, /libraryScroll\.scrollTop = 0/);
});

test("stale full snapshots remain rejected", async () => {
  const { createLauncherStateGate } = await import(pathToFileURL(path.join(appDir, "launcher-state-gate.js")));
  const gate = createLauncherStateGate();
  assert.equal(gate.accept({ launcherStateRevision: 8 }).accepted, true);
  assert.equal(gate.accept({ launcherStateRevision: 7 }).accepted, false);
  assert.equal(gate.accept({ launcherStateRevision: 8 }).accepted, false);
});

test("partial connectivity does not manufacture a global data snapshot", () => {
  const app = source("app.js");
  assert.match(app, /function applyConnectivityState\(connectivityState\)[\s\S]*store\.setState\(\{ connectivity: \{ \.\.\.connectivityState, receivedAt \} \}\)/);
  assert.doesNotMatch(app, /function applyConnectivityState\(connectivityState\)[\s\S]{0,300}data:/);
});

test("delegated listeners bind once across all region updates", () => {
  const app = source("app.js");
  assert.equal((app.match(/bindActions\(\);/g) || []).length, 1);
  assert.equal((app.match(/root\.addEventListener\("click"/g) || []).length, 1);
});

test("observers are reused until the game layout region changes", () => {
  const app = source("app.js");
  assert.match(app, /gameLayoutChanged = changed\.has\("game-identity"\) \|\| changed\.has\("game-visual"\)/);
  assert.match(app, /if \(gameLayoutChanged\) \{[\s\S]*syncGameMetadataLayout\(\)[\s\S]*syncFavoriteTitleMarks\(\)/);
  assert.match(app, /metadataResizeObserver\.disconnect\(\)/);
  assert.match(app, /favoriteTitleResizeObserver\.disconnect\(\)/);
});

test("semantic focus and text selection are restored when a relevant region changes", () => {
  const app = source("app.js");
  assert.match(app, /data-focus-key/);
  assert.match(app, /candidate\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /candidate\.setSelectionRange/);
});

test("focus is not restored when its semantic control disappeared", () => {
  const app = source("app.js");
  assert.match(app, /const attributes = Object\.entries[\s\S]*const candidate =[\s\S]*\.find/);
  assert.match(app, /if \(!candidate \|\| candidate\.disabled\) return/);
});

test("rapid A to B selection keeps stale A callbacks from updating B", () => {
  const app = source("app.js");
  assert.match(app, /const requestId = \+\+libraryPackSelectionSequence/);
  assert.match(app, /requestId !== libraryPackSelectionSequence/);
});

test("visible preferences cannot roll back after a newer local change", () => {
  const app = source("app.js");
  assert.match(app, /startedWithLibraryPreferenceRevision === libraryPreferenceUserRevision/);
  assert.match(app, /libraryPreferencesPersistSequence/);
});

test("renderer regions contain no session secrets or direct network authority", () => {
  const rendererSources = fs.readdirSync(appDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.js$/.test(entry.name))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
  assert.doesNotMatch(rendererSources, /access_token|refresh_token|service_role|Authorization\s*:/i);
  assert.doesNotMatch(rendererSources, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
});
