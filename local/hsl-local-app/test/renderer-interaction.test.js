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

test("changing theme preserves library card HTML and region identity", async () => {
  const [{ createRegionRenderer }, , { renderLibraryPacks }] = await modules();
  const dark = rendererState({ theme: "dark" });
  const light = rendererState({ theme: "light" });
  const darkHtml = renderLibraryPacks(dark);
  const lightHtml = renderLibraryPacks(light);
  const { regions, renderer } = fakeRenderer(createRegionRenderer, ["library-packs"]);

  assert.equal(lightHtml, darkHtml);
  renderer.prime("library-packs", darkHtml);
  const identity = regions.get("library-packs").identity;
  renderer.render("library-packs", lightHtml);
  assert.equal(regions.get("library-packs").identity, identity);
  assert.equal(regions.get("library-packs").writes, 0);
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
  assert.match(source(path.join("components", "library-panel.js")), /data-render-region="library-packs" data-preserve-scroll="library-packs"/);
  assert.match(app, /preservedScrollElements\(region\)/);
  assert.doesNotMatch(app, /function readMainScrollState/);
});

test("the regional scroll contract includes the region itself and bounded descendants", async () => {
  const { preservedScrollElements } = await import(pathToFileURL(path.join(appDir, "region-renderer.js")));
  const child = { dataset: { preserveScroll: "child" } };
  const region = {
    dataset: { preserveScroll: "library-packs" },
    matches: (selector) => selector === "[data-preserve-scroll]",
    querySelectorAll: () => [child],
  };

  assert.deepEqual(preservedScrollElements(region), [region, child]);
  assert.equal(preservedScrollElements({ matches: () => false, querySelectorAll: () => [] }).length, 0);
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
  assert.doesNotMatch(app, /scrollIntoView/);
});

test("pack selection uses incremental attributes without scroll compensation", () => {
  const app = source("app.js");
  const activation = app.slice(
    app.indexOf("async function activateLibraryPackWithPreload"),
    app.indexOf("function bindActions"),
  );

  assert.match(app, /function renderLibraryRegions\(state\)/);
  assert.match(app, /applyLibraryPacksRenderPlan\(/);
  assert.match(app, /syncLibraryPackRegionState\(target, state, renderModel\)/);
  assert.doesNotMatch(app, /libraryPackSelectionScroll|contentBlockSize|applyLibraryPackSelectionExtentLock|releaseLibraryPackSelectionScroll|--library-packs-min-block-size/);
  assert.doesNotMatch(activation, /requestAnimationFrame|scrollTop|scrollIntoView|setTimeout/);
});

test("selection-only states share topology while real library changes invalidate it", async () => {
  const { deriveLibraryPacksRenderModel, libraryPacksTopologyKey, renderLibraryPacks } = await import(
    pathToFileURL(path.join(appDir, "components", "library-panel.js"))
  );
  const initial = rendererState();
  const secondPack = {
    ...initial.data.library.packs[0],
    favoriteKey: "pack-b",
    id: "pack-b",
    instanceKey: "instance-b",
    title: "Game B Extended Edition",
    weekId: "week-b",
  };
  initial.data.library.packs = [...initial.data.library.packs, secondPack];
  initial.data.library.totals.packs = 2;
  const pending = {
    ...initial,
    busy: true,
    libraryActivationInProgress: true,
    pendingLibraryPackId: "pack-b",
  };
  const accepted = {
    ...pending,
    busy: false,
    libraryActivationInProgress: false,
    pendingLibraryPackId: null,
    data: {
      ...pending.data,
      selection: { activeInstanceKey: "instance-b" },
    },
  };
  const topology = (state) => libraryPacksTopologyKey(deriveLibraryPacksRenderModel(state));

  assert.equal(topology(pending), topology(initial));
  assert.equal(topology(accepted), topology(initial));
  assert.notEqual(renderLibraryPacks(pending), renderLibraryPacks(initial));
  assert.notEqual(renderLibraryPacks(accepted), renderLibraryPacks(initial));

  const filterChanged = { ...initial, libraryQuery: "Extended" };
  const sortChanged = { ...initial, librarySortDirection: "desc" };
  const viewChanged = { ...initial, libraryView: "icons" };
  const metadataChanged = {
    ...initial,
    data: {
      ...initial.data,
      library: {
        ...initial.data.library,
        packs: initial.data.library.packs.map((pack, index) => index === 0 ? { ...pack, title: "Renamed Game" } : pack),
      },
    },
  };

  for (const changed of [filterChanged, sortChanged, viewChanged, metadataChanged]) {
    assert.notEqual(topology(changed), topology(initial));
  }
});

test("favorite ON/OFF is incremental in Covers, List and Icons while Favorites filtering stays structural", async () => {
  const { deriveLibraryPacksRenderModel, libraryPacksTopologyKey } = await import(
    pathToFileURL(path.join(appDir, "components", "library-panel.js"))
  );
  const topology = (state) => libraryPacksTopologyKey(deriveLibraryPacksRenderModel(state));

  for (const libraryView of ["covers", "list", "icons"]) {
    const initial = rendererState({ libraryView });
    const favorite = rendererState({ libraryView });
    favorite.data.library.packs = favorite.data.library.packs.map((pack) => ({
      ...pack,
      favorite: true,
      favoritePending: true,
    }));
    assert.equal(topology(favorite), topology(initial), libraryView);

    const acknowledged = rendererState({ libraryView });
    acknowledged.data.library.packs = acknowledged.data.library.packs.map((pack) => ({ ...pack, favorite: true }));
    const rolledBack = rendererState({ libraryView });
    for (const next of [favorite, acknowledged, rolledBack]) {
      assert.equal(topology(next), topology(initial), libraryView);
    }

    const favoritesOnly = { ...favorite, libraryFavoriteFilter: "favorites" };
    const noneFavorite = rendererState({ libraryFavoriteFilter: "favorites", libraryView });
    assert.notEqual(topology(favoritesOnly), topology(noneFavorite), libraryView);
  }
});

test("incremental selection preserves card identity and synchronizes accessibility", async () => {
  const [{ syncLibraryPackRegionState }, { deriveLibraryPacksRenderModel }] = await Promise.all([
    import(pathToFileURL(path.join(appDir, "library-card-sync.js"))),
    import(pathToFileURL(path.join(appDir, "components", "library-panel.js"))),
  ]);
  const attributes = (entries = {}) => new Map(Object.entries(entries));
  const fakeCard = (instanceKey) => {
    const cardAttributes = attributes({ "aria-current": "false", "data-action": "use-library-pack", "data-pack-id": instanceKey.replace("instance", "pack"), role: "button", tabindex: "0" });
    const classes = new Set(["pack-card"]);
    const favoriteAttributes = attributes({ "aria-pressed": "false", title: "Marcar como favorito" });
    const favoriteClasses = new Set(["favorite-slot"]);
    const favorite = {
      disabled: false,
      innerHTML: "",
      classList: {
        contains: (name) => favoriteClasses.has(name),
        toggle(name, enabled) {
          if (enabled) favoriteClasses.add(name);
          else favoriteClasses.delete(name);
        },
      },
      querySelector: () => ({ dataset: { icon: "star-empty" } }),
      setAttribute: (name, value) => favoriteAttributes.set(name, String(value)),
    };
    return {
      attributes: cardAttributes,
      classList: {
        contains: (name) => classes.has(name),
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      dataset: { instanceKey, selected: "false" },
      getAttribute: (name) => cardAttributes.get(name) ?? null,
      querySelector: (selector) => selector === '[data-action="toggle-library-favorite"]' ? favorite : null,
      removeAttribute: (name) => cardAttributes.delete(name),
      setAttribute: (name, value) => cardAttributes.set(name, String(value)),
      favorite,
    };
  };
  const activeCard = fakeCard("instance-a");
  const pendingCard = fakeCard("instance-b");
  const cards = [activeCard, pendingCard];
  const region = { querySelectorAll: () => cards };
  const packs = [
    { id: "pack-a", instanceKey: "instance-a", status: "ready" },
    { id: "pack-b", instanceKey: "instance-b", status: "ready" },
  ];
  const state = rendererState({
    busy: true,
    libraryActivationInProgress: true,
    pendingLibraryPackId: "pack-b",
  });
  state.data.library.packs = packs;

  assert.deepEqual(syncLibraryPackRegionState(region, state, deriveLibraryPacksRenderModel(state)), {
    ok: true,
    reason: null,
    synchronized: 2,
  });
  assert.equal(activeCard.dataset.selected, "true");
  assert.equal(activeCard.getAttribute("aria-current"), "true");
  assert.equal(activeCard.getAttribute("data-action"), null);
  assert.equal(activeCard.getAttribute("role"), null);
  assert.equal(activeCard.getAttribute("tabindex"), "-1");
  assert.equal(pendingCard.classList.contains("pack-card--pending"), true);
  assert.equal(pendingCard.getAttribute("aria-busy"), "true");
  assert.equal(pendingCard.getAttribute("data-action"), "use-library-pack");
  assert.equal(activeCard.favorite.disabled, true);
  assert.equal(pendingCard.favorite.disabled, true);

  const accepted = rendererState();
  accepted.data.library.packs = packs;
  accepted.data.selection.activeInstanceKey = "instance-b";
  syncLibraryPackRegionState(region, accepted, deriveLibraryPacksRenderModel(accepted));
  assert.equal(cards[0], activeCard);
  assert.equal(cards[1], pendingCard);
  assert.equal(activeCard.dataset.selected, "false");
  assert.equal(activeCard.getAttribute("aria-current"), "false");
  assert.equal(activeCard.getAttribute("data-action"), "use-library-pack");
  assert.equal(activeCard.getAttribute("role"), "button");
  assert.equal(activeCard.getAttribute("tabindex"), "0");
  assert.equal(pendingCard.dataset.selected, "true");
  assert.equal(pendingCard.getAttribute("data-action"), null);
  assert.equal(pendingCard.getAttribute("role"), null);
  assert.equal(pendingCard.getAttribute("tabindex"), "-1");
  assert.equal(pendingCard.getAttribute("aria-busy"), null);
  assert.equal(activeCard.favorite.disabled, false);
  assert.equal(pendingCard.favorite.disabled, false);
});

test("result-changing filters reset library scroll before state while presentation toggles do not", () => {
  const app = source("app.js");
  const bind = app.slice(app.indexOf("function bindActions"));
  const filtersToggle = bind.slice(
    bind.indexOf('if (action === "toggle-library-filters")'),
    bind.indexOf('if (action === "toggle-library-favorite")'),
  );

  assert.equal((app.match(/function resetLibraryResultsScroll\(\)/g) || []).length, 1);
  for (const marker of [
    "input.value === store.getState().libraryQuery",
    "target.value === store.getState().librarySeason",
    "librarySortBy === store.getState().librarySortBy",
    "librarySortDirection === store.getState().librarySortDirection",
    'action === "toggle-library-favorite-filter"',
  ]) {
    const start = bind.indexOf(marker);
    const stateWrite = bind.indexOf("store.setState", start);
    const reset = bind.indexOf("resetLibraryResultsScroll()", start);
    assert.ok(start >= 0, marker);
    assert.ok(reset > start && reset < stateWrite, marker);
  }
  assert.doesNotMatch(filtersToggle, /resetLibraryResultsScroll/);
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

test("hero indicators stay regional while the metadata observer remains scoped", () => {
  const app = source("app.js");
  assert.match(app, /gameLayoutChanged = changed\.has\("game-identity"\) \|\| changed\.has\("game-visual"\)/);
  assert.match(app, /"game-hero-indicators": renderGameHeroIndicatorsRegion\(state\)/);
  assert.match(app, /if \(gameLayoutChanged\) \{[\s\S]*syncGameMetadataLayout\(\)/);
  assert.match(app, /metadataResizeObserver\.disconnect\(\)/);
  assert.doesNotMatch(app, /favoriteTitleResizeObserver|favoriteTitleFrame|syncFavoriteTitleMarks/);
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
