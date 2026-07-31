const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");
const source = (relativePath) => fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");

function state(overrides = {}) {
  const base = {
    busy: false,
    connectivity: { reachability: "connected", reachabilityGeneration: 1 },
    data: {
      accounts: { activeUserId: "player", knownAccounts: [] },
      autoSync: { status: "idle" },
      bridge: { contractStatus: "current", deprecated: false },
      game: {
        assets: {
          hero: { url: "file:///hero.png" },
          logo: { url: "file:///logo.png" },
        },
        displayName: "Indiana Jones and the Temple of Doom",
        favorite: true,
        instanceKey: "instance-a",
        manual: { available: true },
        weekId: "week-a",
      },
      library: {
        directory: { available: true, configured: true, path: "C:/packs" },
        packs: [{ instanceKey: "instance-a" }],
        status: "available-populated",
      },
      membership: {
        canPlayCompetition: true,
        canSubmit: true,
        checkedAt: "2026-07-31T10:00:00.000Z",
        status: "member",
        weekId: "week-a",
      },
      queue: { totals: { failed: 0, pending: 0, sent: 0 } },
      readiness: {
        blockers: [],
        canPlayCompetition: true,
        canPractice: true,
        canSubmit: true,
        checks: [],
        status: "ready",
        warnings: [],
      },
      remoteConfiguration: { status: "configured" },
      selection: { activeInstanceKey: "instance-a" },
      session: { hasSession: true, remoteUsable: true, requiresLogin: false, userId: "player" },
    },
    rankingCapabilities: {
      entries: { "week-a": { status: "available", url: "https://hsl.test/week-a", weekId: "week-a" } },
      webBaseUrl: "https://hsl.test",
    },
    rankingOpening: false,
  };

  return {
    ...base,
    ...overrides,
    data: { ...base.data, ...(overrides.data || {}) },
  };
}

function checkingState(overrides = {}) {
  const base = state();
  return state({
    ...overrides,
    data: {
      ...overrides.data,
      membership: {
        canPlayCompetition: false,
        canSubmit: false,
        generation: 7,
        resolution: {
          accountId: "player",
          active: true,
          contextCurrent: true,
          generation: 7,
          instanceKey: "instance-a",
          weekId: "week-a",
        },
        status: "checking",
        weekId: "week-a",
      },
      readiness: {
        ...base.data.readiness,
        blockers: ["Comprobando participación."],
        canPlayCompetition: false,
        status: "blocked",
      },
    },
  });
}

async function gamePanelApi() {
  return import(pathToFileURL(path.join(rendererRoot, "components", "game-panel.js")).href);
}

test("title favorite positioning machinery is completely removed", () => {
  const app = source("app.js");
  const panel = source(path.join("components", "game-panel.js"));
  const styles = source(path.join("styles", "app.css"));
  const combined = `${app}\n${panel}\n${styles}`;

  assert.doesNotMatch(panel, /renderDetailFavoriteMark|game-favorite-mark/);
  assert.doesNotMatch(app, /normalizeFavoriteTitleLineRects|computeFavoriteStarPosition|placeFavoriteTitleMark|syncFavoriteTitleMarks/);
  assert.doesNotMatch(app, /favoriteTitleResizeObserver|favoriteTitleFrame|document\.createRange|getClientRects|document\.fonts/);
  assert.doesNotMatch(styles, /favorite-star-safe-space|favorite-mark-left|favorite-mark-top|game-favorite-mark/);
  assert.doesNotMatch(combined, /renderIcon\("heart/);
});

test("favorite and competition-ready render together in the hero with star and check", async () => {
  const {
    renderGameHeroIndicatorsRegion,
    renderGameIdentityRegion,
    renderGameStatusRegion,
  } = await gamePanelApi();
  const ready = state();
  const indicators = renderGameHeroIndicatorsRegion(ready);

  assert.match(indicators, /data-indicator-count="2"/);
  assert.match(indicators, /game-hero-indicator--favorite/);
  assert.match(indicators, /ui-icon--star-filled/);
  assert.match(indicators, />Favorito</);
  assert.match(indicators, /aria-label="Juego favorito"/);
  assert.match(indicators, /game-hero-indicator--ready/);
  assert.match(indicators, /ui-icon--check/);
  assert.match(indicators, />Pack listo</);
  assert.match(indicators, /aria-label="Pack listo"/);
  assert.equal(renderGameStatusRegion(ready), "");
  assert.doesNotMatch(renderGameIdentityRegion(ready), /star-filled|Favorito|game-favorite-mark/);
});

test("each hero indicator follows only its canonical condition", async () => {
  const { renderGameHeroIndicatorsRegion, renderGameStatusRegion } = await gamePanelApi();
  const readyNotFavorite = state({ data: { game: { ...state().data.game, favorite: false } } });
  const checkingFavorite = checkingState();
  const checkingNotFavorite = checkingState({
    data: { game: { ...state().data.game, favorite: false } },
  });
  const notMember = state({
    data: {
      membership: { canPlayCompetition: false, status: "not_member", weekId: "week-a" },
      readiness: { ...state().data.readiness, canPlayCompetition: false, status: "blocked" },
    },
  });

  assert.doesNotMatch(renderGameHeroIndicatorsRegion(readyNotFavorite), /favorite|Favorito/i);
  assert.match(renderGameHeroIndicatorsRegion(readyNotFavorite), /game-hero-indicator--ready/);
  assert.match(renderGameHeroIndicatorsRegion(checkingFavorite), /game-hero-indicator--favorite/);
  assert.doesNotMatch(renderGameHeroIndicatorsRegion(checkingFavorite), /game-hero-indicator--ready|>Pack listo</);
  assert.equal(renderGameHeroIndicatorsRegion(checkingNotFavorite), "");
  assert.match(renderGameHeroIndicatorsRegion(notMember), /game-hero-indicator--favorite/);
  assert.doesNotMatch(renderGameHeroIndicatorsRegion(notMember), /game-hero-indicator--ready|>Pack listo</);
  assert.match(renderGameStatusRegion(checkingFavorite), /Comprobando participación/);
  assert.match(renderGameStatusRegion(notMember), /No participas en la temporada/);
});

test("hero indicators are a sibling region and never alter visual asset HTML", async () => {
  const { createRegionRenderer } = await import(pathToFileURL(path.join(rendererRoot, "region-renderer.js")).href);
  const {
    renderGameHeroIndicatorsRegion,
    renderGamePanel,
    renderGameVisualRegion,
  } = await gamePanelApi();
  const ready = state();
  const notFavorite = state({ data: { game: { ...ready.data.game, favorite: false } } });
  const checking = checkingState();
  const regions = new Map([
    ["game-visual", { html: "", identity: Symbol("visual"), writes: 0 }],
    ["game-hero-indicators", { html: "", identity: Symbol("indicators"), writes: 0 }],
  ]);
  const renderer = createRegionRenderer({
    findRegion: (name) => regions.get(name),
    writeRegion(region, html) {
      region.html = html;
      region.identity = Symbol("replacement");
      region.writes += 1;
    },
  });

  renderer.prime("game-visual", renderGameVisualRegion(ready));
  renderer.prime("game-hero-indicators", renderGameHeroIndicatorsRegion(ready));
  const visualIdentity = regions.get("game-visual").identity;
  renderer.render("game-visual", renderGameVisualRegion(notFavorite));
  renderer.render("game-hero-indicators", renderGameHeroIndicatorsRegion(notFavorite));
  assert.equal(regions.get("game-visual").identity, visualIdentity);
  assert.equal(regions.get("game-visual").writes, 0);
  assert.equal(regions.get("game-hero-indicators").writes, 1);
  assert.equal(renderGameVisualRegion(ready), renderGameVisualRegion(checking));
  assert.match(renderGamePanel(ready), /game-hero-shell[\s\S]*data-render-region="game-visual"[\s\S]*data-render-region="game-hero-indicators"/);
});

test("responsive indicators use CSS pills and icon-only circles without interaction", () => {
  const panel = source(path.join("components", "game-panel.js"));
  const styles = source(path.join("styles", "app.css"));

  assert.match(styles, /\.game-hero-shell[\s\S]*container: game-hero \/ inline-size/);
  assert.match(styles, /\.game-hero-indicators[\s\S]*right: 16px[\s\S]*bottom: 16px/);
  assert.match(styles, /\.game-hero-indicator[\s\S]*height: 38px[\s\S]*border-radius: 999px[\s\S]*white-space: nowrap/);
  assert.match(styles, /@container game-hero \(max-width: 520px\)[\s\S]*data-indicator-count="2"[\s\S]*width: 40px[\s\S]*height: 40px/);
  assert.match(styles, /@container game-hero \(max-width: 360px\)[\s\S]*\.game-hero-indicator__label[\s\S]*clip-path: inset\(50%\)/);
  assert.match(styles, /\.game-hero-indicators-region[\s\S]*pointer-events: none/);
  assert.match(styles, /\.game-hero-indicator[\s\S]*cursor: default[\s\S]*pointer-events: none/);
  assert.doesNotMatch(panel, /<button[^>]*game-hero-indicator|tabindex=|aria-live/);
});

test("library favorite controls and optimistic persistence remain intact", () => {
  const app = source("app.js");
  const card = source(path.join("components", "pack-card.js"));
  const library = source(path.join("components", "library-panel.js"));

  assert.match(card, /data-action="toggle-library-favorite"/);
  assert.match(card, /renderIcon\(favorite \? "star-filled" : "star-empty"/);
  assert.match(library, /data-action="toggle-library-favorite-filter"/);
  assert.match(app, /async function toggleLibraryFavorite/);
  assert.match(app, /favoriteSyncByKey/);
  assert.match(app, /window\.hslLauncher\.toggleLibraryFavorite/);
});
