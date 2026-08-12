const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const rendererDir = path.join(__dirname, "..", "gui", "renderer");
const moduleUrl = (...parts) => pathToFileURL(path.join(rendererDir, ...parts));

function pack(patch = {}) {
  return {
    cover: { url: "file:///cover-a.png" },
    developer: "Studio A",
    favorite: false,
    favoriteKey: "pack-a",
    genre: ["Arcade"],
    icon: { url: "file:///icon-a.png" },
    id: "pack-a",
    instanceKey: "instance-a",
    seasonId: "season-a",
    seasonName: "Season A",
    status: "ready",
    subtitle: "Subtitle A",
    title: "Game A",
    weekCapability: { publicState: "active" },
    weekId: "week-a",
    year: "1984",
    ...patch,
  };
}

function state({ packs = [pack()], ...patch } = {}) {
  return {
    busy: false,
    data: {
      library: {
        directory: { available: true, configured: true, path: "C:/packs" },
        packs,
        status: "available-populated",
        totals: { packs: packs.length },
      },
      selection: { activeInstanceKey: "instance-a" },
      session: { hasSession: true },
    },
    libraryActivationInProgress: false,
    libraryFavoriteFilter: "all",
    libraryQuery: "",
    librarySeason: "all",
    librarySortBy: "weeks",
    librarySortDirection: "asc",
    libraryStatus: "all",
    libraryView: "covers",
    pendingLibraryPackId: null,
    ...patch,
  };
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    contains: (name) => values.has(name),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
    values,
  };
}

function element({ classes = [], dataset = {} } = {}) {
  const attributes = new Map();
  return {
    attributes,
    classList: classList(classes),
    dataset: { ...dataset },
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    textContent: "",
  };
}

function cardFor(view, instanceKey = "instance-a") {
  const card = element({ classes: ["pack-card"], dataset: { instanceKey, selected: "false" } });
  const status = element();
  const label = view === "icons" ? null : element({ classes: ["week-status-badge", "week-status--unknown"] });
  const beacon = view === "icons"
    ? element({ classes: ["status-beacon", "status-beacon--neutral", "status-beacon--pack"] })
    : null;
  status.querySelector = (selector) => {
    if (selector === "[data-pack-status-label]") return label;
    if (selector === "[data-pack-status-beacon]") return beacon;
    return null;
  };
  card.querySelector = (selector) => {
    if (selector === "[data-pack-status]") return status;
    return null;
  };
  return { beacon, card, label, status };
}

test("topology ignores live selection, busy, favorite and Week Capability in every view", async () => {
  const { deriveLibraryPacksRenderModel, libraryPacksTopologyKey } = await import(moduleUrl("components", "library-panel.js"));
  const key = (value) => libraryPacksTopologyKey(deriveLibraryPacksRenderModel(value));

  for (const libraryView of ["covers", "list", "icons"]) {
    const initial = state({ libraryView });
    const expected = key(initial);
    const transitions = [
      state({ libraryView, data: { ...initial.data, selection: { activeInstanceKey: "instance-b" } } }),
      state({ libraryView, busy: true, libraryActivationInProgress: true, pendingLibraryPackId: "pack-a" }),
      state({ libraryView, packs: [pack({ favorite: true, favoritePending: true })] }),
      ...["closed", "unknown", "active"].map((publicState) => state({
        libraryView,
        packs: [pack({ weekCapability: { publicState } })],
      })),
    ];
    for (const next of transitions) assert.equal(key(next), expected, `${libraryView}: ${JSON.stringify(next)}`);
  }
});

test("favorites and status affect topology only when the active filter changes the visible set", async () => {
  const { deriveLibraryPacksRenderModel, libraryPacksTopologyKey } = await import(moduleUrl("components", "library-panel.js"));
  const key = (value) => libraryPacksTopologyKey(deriveLibraryPacksRenderModel(value));
  assert.equal(key(state()), key(state({ packs: [pack({ favorite: true })] })));
  assert.notEqual(
    key(state({ libraryFavoriteFilter: "favorites" })),
    key(state({ libraryFavoriteFilter: "favorites", packs: [pack({ favorite: true })] })),
  );
  assert.equal(key(state()), key(state({ packs: [pack({ status: "error" })] })));
  assert.notEqual(
    key(state({ libraryStatus: "attention" })),
    key(state({ libraryStatus: "attention", packs: [pack({ status: "error" })] })),
  );
  assert.notEqual(
    key(state({ libraryStatus: "installed" })),
    key(state({ libraryStatus: "installed", packs: [pack({ status: "missing" })] })),
  );
});

test("real card metadata, media, identity, grouping, order and view invalidate topology", async () => {
  const { deriveLibraryPacksRenderModel, libraryPacksTopologyKey } = await import(moduleUrl("components", "library-panel.js"));
  const key = (value) => libraryPacksTopologyKey(deriveLibraryPacksRenderModel(value));
  const initial = state();
  const initialKey = key(initial);
  const packChanges = [
    { title: "Renamed" },
    { subtitle: "Another subtitle" },
    { developer: "Studio B" },
    { year: "1985" },
    { genre: ["Puzzle"] },
    { cover: { url: "file:///cover-b.png" } },
    { cover: null },
    { id: "pack-b" },
    { instanceKey: "instance-b" },
    { favoriteKey: "favorite-b" },
    { seasonId: "season-b", seasonName: "Season B" },
  ];
  for (const change of packChanges) assert.notEqual(key(state({ packs: [pack(change)] })), initialKey, JSON.stringify(change));
  assert.notEqual(key(state({ libraryView: "list" })), initialKey);

  const twoPacks = [pack(), pack({ id: "pack-b", instanceKey: "instance-b", favoriteKey: "pack-b", title: "Game B" })];
  assert.notEqual(
    key(state({ librarySortBy: "title", librarySortDirection: "asc", packs: twoPacks })),
    key(state({ librarySortBy: "title", librarySortDirection: "desc", packs: twoPacks })),
  );
});

test("shared status authority incrementally synchronizes badges and beacons", async () => {
  const { syncLibraryPackCardState } = await import(moduleUrl("library-card-sync.js"));
  const cases = [
    [pack({ status: "error" }), "REQUIERE ATENCION", "week-status--error", "error", "Este pack esta incompleto o no es valido."],
    [pack({ weekCapability: { publicState: "active" } }), "ACTIVA", "week-status--ready", "success", "La semana competitiva esta activa."],
    [pack({ weekCapability: { publicState: "inactive" } }), "INACTIVA", "week-status--warning", "warning", "La semana competitiva todavia no esta activa."],
    [pack({ weekCapability: { publicState: "closed" } }), "CERRADA", "week-status--closed", "warning", "La semana competitiva esta cerrada."],
    [pack({ weekCapability: null, weekId: null }), "SIN VINCULAR", "week-status--warning", "warning", "El pack no esta vinculado a una semana publica."],
    [pack({ weekCapability: { publicState: "unknown" } }), "SIN DATOS", "week-status--unknown", "neutral", "Todavia no se ha confirmado el estado de la semana."],
  ];

  for (const [sourcePack, expectedLabel, expectedClass, expectedTone, expectedTitle] of cases) {
    const covers = cardFor("covers");
    const coversState = state({ packs: [sourcePack] });
    syncLibraryPackCardState(covers.card, sourcePack, coversState);
    assert.equal(covers.label.textContent, expectedLabel);
    assert.equal(covers.label.classList.contains(expectedClass), true);
    assert.equal(covers.status.attributes.get("title"), expectedTitle);

    const icons = cardFor("icons");
    syncLibraryPackCardState(icons.card, sourcePack, coversState);
    assert.equal(icons.beacon.attributes.get("aria-label"), expectedLabel);
    assert.equal(icons.beacon.classList.contains(`status-beacon--${expectedTone}`), true);
    assert.equal(icons.status.attributes.get("title"), covers.status.attributes.get("title"));
  }
});

test("same topology with different full status HTML patches in place and primes the new snapshot", async () => {
  const [panel, sync, plan, regions] = await Promise.all([
    import(moduleUrl("components", "library-panel.js")),
    import(moduleUrl("library-card-sync.js")),
    import(moduleUrl("library-render-plan.js")),
    import(moduleUrl("region-renderer.js")),
  ]);
  const before = state();
  const after = state({ packs: [pack({ weekCapability: { publicState: "closed" } })] });
  const beforeModel = panel.deriveLibraryPacksRenderModel(before);
  const afterModel = panel.deriveLibraryPacksRenderModel(after);
  const beforeKey = panel.libraryPacksTopologyKey(beforeModel);
  const afterKey = panel.libraryPacksTopologyKey(afterModel);
  const beforeHtml = panel.renderLibraryPacks(before, beforeModel);
  const afterHtml = panel.renderLibraryPacks(after, afterModel);
  const fixture = cardFor("covers");
  const region = { querySelectorAll: () => [fixture.card] };
  let writes = 0;
  const regionRenderer = regions.createRegionRenderer({
    findRegion: () => region,
    writeRegion: () => { writes += 1; },
  });
  regionRenderer.prime("library-packs", beforeHtml);

  assert.equal(beforeKey, afterKey);
  assert.notEqual(beforeHtml, afterHtml);
  const result = plan.applyLibraryPacksRenderPlan({
    currentTopologyKey: beforeKey,
    html: afterHtml,
    model: afterModel,
    nextTopologyKey: afterKey,
    region,
    regionRenderer,
    synchronize: (target, model) => sync.syncLibraryPackRegionState(target, after, model),
  });
  assert.equal(result.mode, "incremental");
  assert.equal(result.wrote, false);
  assert.equal(writes, 0);
  assert.equal(fixture.label.textContent, "CERRADA");
  assert.equal(regionRenderer.snapshot("library-packs"), afterHtml);
});

test("DOM topology mismatch refuses a partial patch and falls back to structural render", async () => {
  const [panel, sync, plan, regions] = await Promise.all([
    import(moduleUrl("components", "library-panel.js")),
    import(moduleUrl("library-card-sync.js")),
    import(moduleUrl("library-render-plan.js")),
    import(moduleUrl("region-renderer.js")),
  ]);
  const expected = state({ packs: [
    pack(),
    pack({ id: "pack-b", instanceKey: "instance-b", favoriteKey: "pack-b", title: "Game B" }),
  ] });
  const model = panel.deriveLibraryPacksRenderModel(expected);
  const onlyA = cardFor("covers", "instance-a").card;
  const region = { querySelectorAll: () => [onlyA] };
  assert.deepEqual(sync.syncLibraryPackRegionState(region, expected, model), {
    ok: false,
    reason: "dom-topology-mismatch",
    synchronized: 0,
  });

  let writes = 0;
  const regionRenderer = regions.createRegionRenderer({ findRegion: () => region, writeRegion: () => { writes += 1; } });
  const key = panel.libraryPacksTopologyKey(model);
  const html = panel.renderLibraryPacks(expected, model);
  regionRenderer.prime("library-packs", html);
  const result = plan.applyLibraryPacksRenderPlan({
    currentTopologyKey: key,
    html,
    model,
    nextTopologyKey: key,
    region,
    regionRenderer,
    synchronize: (target, renderModel) => sync.syncLibraryPackRegionState(target, expected, renderModel),
  });
  assert.equal(result.mode, "structural");
  assert.equal(result.synchronization.reason, "dom-topology-mismatch");
  assert.equal(result.wrote, true);
  assert.equal(writes, 1);
});

test("passive connectivity paths contain no scroll reset or compensation", () => {
  const app = fs.readFileSync(path.join(rendererDir, "app.js"), "utf8");
  const slice = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
  const passive = [
    slice("function applyConnectivityState", "function applyRankingCapabilitiesState"),
    slice("function applyBackgroundLauncherState", "async function syncLibraryFavorite"),
    slice('if (action === "refresh-connectivity")', 'if (action === "check-membership")'),
  ].join("\n");
  assert.doesNotMatch(passive, /resetLibraryResultsScroll|scrollTop|scrollIntoView|requestAnimationFrame|setTimeout/);
  const syncSource = fs.readFileSync(path.join(rendererDir, "library-card-sync.js"), "utf8");
  const planSource = fs.readFileSync(path.join(rendererDir, "library-render-plan.js"), "utf8");
  assert.doesNotMatch(`${syncSource}\n${planSource}`, /scrollTop|scrollIntoView|requestAnimationFrame|setTimeout/);
});
