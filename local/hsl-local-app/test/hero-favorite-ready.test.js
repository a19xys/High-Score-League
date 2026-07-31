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

function errorState(overrides = {}) {
  const base = state();
  return state({
    ...overrides,
    data: {
      ...overrides.data,
      readiness: {
        ...base.data.readiness,
        blockers: ["No se encontro mame.exe.", "Falta la ROM necesaria."],
        canPlayCompetition: false,
        canPractice: false,
        checks: [
          { id: "runtime-shared", level: "error", message: "MAME no disponible" },
          { id: "rom-file", level: "error", message: "Falta la ROM necesaria" },
        ],
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
    deriveGameHeroStatusPresentation,
    renderGameHeroIndicatorsRegion,
    renderGameIdentityRegion,
    renderGameStatusRegion,
  } = await gamePanelApi();
  const ready = state();
  const indicators = renderGameHeroIndicatorsRegion(ready);
  const status = deriveGameHeroStatusPresentation(ready);

  assert.match(indicators, /data-indicator-count="2"/);
  assert.match(indicators, /game-hero-indicator--favorite/);
  assert.match(indicators, /ui-icon--star-filled/);
  assert.match(indicators, />Favorito</);
  assert.match(indicators, /aria-label="Juego favorito"/);
  assert.match(indicators, /game-hero-indicator--ready/);
  assert.match(indicators, /ui-icon--check/);
  assert.match(indicators, />Pack listo</);
  assert.match(indicators, /aria-label="Pack listo"/);
  assert.deepEqual(status, { icon: "check", label: "Pack listo", severity: "success", status: "ready" });
  assert.equal(renderGameStatusRegion(ready), "");
  assert.doesNotMatch(renderGameIdentityRegion(ready), /star-filled|Favorito|game-favorite-mark/);
});

test("checking moves to the hero while account states remain explanatory below", async () => {
  const {
    deriveGameHeroStatusPresentation,
    renderGameHeroIndicatorsRegion,
    renderGameStatusRegion,
  } = await gamePanelApi();
  const readyNotFavorite = state({ data: { game: { ...state().data.game, favorite: false } } });
  const checkingFavorite = checkingState();
  const checkingNotFavorite = checkingState({
    data: { game: { ...state().data.game, favorite: false } },
  });
  const checkingReady = state({
    data: {
      membership: checkingState().data.membership,
      readiness: state().data.readiness,
    },
  });
  const notMember = state({
    data: {
      membership: { canPlayCompetition: false, status: "not_member", weekId: "week-a" },
      readiness: {
        ...state().data.readiness,
        canPlayCompetition: false,
        checks: [{ id: "membership", level: "error", message: "No participas" }],
        status: "blocked",
      },
    },
  });
  const requiresLogin = state({
    data: {
      membership: { canPlayCompetition: false, status: "unauthenticated", weekId: "week-a" },
      readiness: {
        ...state().data.readiness,
        canPlayCompetition: false,
        checks: [{ id: "session", level: "error", message: "Inicia sesion" }],
        status: "blocked",
      },
      session: { hasSession: false, remoteUsable: false, requiresLogin: true, userId: "player" },
    },
  });

  assert.doesNotMatch(renderGameHeroIndicatorsRegion(readyNotFavorite), /favorite|Favorito/i);
  assert.match(renderGameHeroIndicatorsRegion(readyNotFavorite), /game-hero-indicator--ready/);
  assert.match(renderGameHeroIndicatorsRegion(checkingFavorite), /game-hero-indicator--favorite/);
  assert.match(renderGameHeroIndicatorsRegion(checkingFavorite), /game-hero-indicator--checking/);
  assert.match(renderGameHeroIndicatorsRegion(checkingFavorite), /ui-icon--refresh/);
  assert.match(renderGameHeroIndicatorsRegion(checkingFavorite), />Comprobando</);
  assert.doesNotMatch(renderGameHeroIndicatorsRegion(checkingFavorite), /game-hero-indicator--ready|>Pack listo</);
  assert.match(renderGameHeroIndicatorsRegion(checkingNotFavorite), /data-indicator-count="1"/);
  assert.match(renderGameHeroIndicatorsRegion(checkingNotFavorite), /game-hero-indicator--checking/);
  assert.equal(deriveGameHeroStatusPresentation(checkingReady).status, "checking");
  assert.match(renderGameHeroIndicatorsRegion(notMember), /game-hero-indicator--favorite/);
  assert.doesNotMatch(renderGameHeroIndicatorsRegion(notMember), /game-hero-indicator--status|>Con errores|>Pack listo|>Comprobando</);
  assert.equal(deriveGameHeroStatusPresentation(notMember), null);
  assert.equal(deriveGameHeroStatusPresentation(requiresLogin), null);
  assert.equal(renderGameStatusRegion(checkingFavorite), "");
  assert.match(renderGameStatusRegion(notMember), /No participas en la temporada/);
  assert.match(renderGameStatusRegion(requiresLogin), /Vuelve a iniciar sesión/);
});

test("pack errors have precedence and collapse to one generic hero status", async () => {
  const {
    deriveGameHeroStatusPresentation,
    renderGameHeroIndicatorsRegion,
    renderGameStatusRegion,
  } = await gamePanelApi();
  const errors = errorState();
  const checkingWithErrors = state({
    data: {
      membership: checkingState().data.membership,
      readiness: errorState().data.readiness,
    },
  });
  const html = renderGameHeroIndicatorsRegion(errors);
  const checkingHtml = renderGameHeroIndicatorsRegion(checkingWithErrors);

  assert.deepEqual(deriveGameHeroStatusPresentation(errors), {
    icon: "error",
    label: "Con errores",
    severity: "error",
    status: "error",
  });
  assert.equal((html.match(/game-hero-indicator--status/g) || []).length, 1);
  assert.match(html, /game-hero-indicator--error/);
  assert.match(html, /ui-icon--error/);
  assert.match(html, />Con errores</);
  assert.doesNotMatch(html, /MAME no disponible|Falta la ROM|runtime-shared|rom-file/);
  assert.match(checkingHtml, /game-hero-indicator--error/);
  assert.doesNotMatch(checkingHtml, />Comprobando|>Pack listo/);
  assert.equal(renderGameStatusRegion(errors), "");
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
  const errors = errorState();
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
  assert.equal(renderGameVisualRegion(ready), renderGameVisualRegion(errors));
  renderer.render("game-hero-indicators", renderGameHeroIndicatorsRegion(checking));
  renderer.render("game-hero-indicators", renderGameHeroIndicatorsRegion(errors));
  assert.equal(regions.get("game-visual").identity, visualIdentity);
  assert.equal(regions.get("game-visual").writes, 0);
  assert.equal(regions.get("game-hero-indicators").writes, 3);
  assert.match(renderGamePanel(ready), /game-hero-shell[\s\S]*data-render-region="game-visual"[\s\S]*data-render-region="game-hero-indicators"/);
  assert.doesNotMatch(renderGamePanel(ready), /data-render-region="game-status">\s*<div class="badge-row"/);
  assert.doesNotMatch(renderGamePanel(checking), /data-render-region="game-status">\s*<div class="badge-row"/);
  assert.doesNotMatch(renderGamePanel(errors), /data-render-region="game-status">\s*<div class="badge-row"/);
});

test("the hero gives every logo ratio a bounded safe area beside the indicator lane", () => {
  const panel = source(path.join("components", "game-panel.js"));
  const styles = source(path.join("styles", "app.css"));

  assert.match(styles, /\.game-hero-shell[\s\S]*grid-template-columns:[\s\S]*--hero-indicator-lane-min/);
  assert.match(styles, /\.game-hero-shell[\s\S]*grid-template-rows: minmax\(0, 1fr\)/);
  assert.match(panel, /game-hero-logo-safe-area[\s\S]*game-hero__logo/);
  assert.match(styles, /\.game-hero-shell \.game-hero-logo-safe-area[\s\S]*height: 100%[\s\S]*min-height: 0[\s\S]*max-width: min\(76cqi,[\s\S]*max-height: 100%[\s\S]*overflow: hidden[\s\S]*align-items: end[\s\S]*grid-area: 1 \/ 2[\s\S]*padding-block: var\(--hero-safe-block-inset\)/);
  const logoRule = styles.match(/\.game-hero-shell \.game-hero__logo\s*\{([^}]*)\}/)?.[1] || "";
  assert.match(logoRule, /width: auto/);
  assert.match(logoRule, /height: auto/);
  assert.match(logoRule, /max-inline-size: min\(100%, 520px\)/);
  assert.match(logoRule, /max-block-size: min\(58%, 166px\)/);
  assert.match(logoRule, /align-self: end/);
  assert.match(logoRule, /object-fit: contain/);
  assert.doesNotMatch(logoRule, /max-(?:width|height): 100%/);
  assert.match(styles, /\.game-hero-indicators-region[\s\S]*grid-area: 1 \/ 3[\s\S]*container: hero-indicator-lane \/ inline-size/);
  assert.match(styles, /not\(:has\(\.game-hero-stage--with-logo\)\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /not\(:has\(\.game-hero-stage--with-logo\)\) \.game-hero-logo-safe-area[\s\S]*display: none/);
  assert.match(styles, /\.game-hero-indicators[\s\S]*right: var\(--hero-indicator-edge-inset\)[\s\S]*bottom: var\(--hero-indicator-edge-inset\)/);
  assert.doesNotMatch(`${panel}\n${styles}`, /Space Invaders|space-invaders|ResizeObserver|getBoundingClientRect|naturalWidth|naturalHeight/);
});

test("responsive indicators remain CSS pills and icon-only circles without interaction", () => {
  const panel = source(path.join("components", "game-panel.js"));
  const styles = source(path.join("styles", "app.css"));

  assert.match(styles, /\.game-hero-indicator[\s\S]*height: 38px[\s\S]*border-radius: 999px[\s\S]*white-space: nowrap/);
  assert.match(styles, /@container hero-indicator-lane \(max-width: 271px\)[\s\S]*data-indicator-count="2"[\s\S]*width: 40px[\s\S]*height: 40px/);
  assert.match(styles, /@container hero-indicator-lane \(max-width: 159px\)[\s\S]*game-hero-indicator--status/);
  assert.match(styles, /@container hero-indicator-lane \(max-width: 119px\)[\s\S]*game-hero-indicator--favorite/);
  assert.doesNotMatch(styles, /@container game-hero \(max-width: (?:360|520)px\)/);
  assert.match(styles, /\.game-hero-indicators-region[\s\S]*pointer-events: none/);
  assert.match(styles, /\.game-hero-indicator[\s\S]*cursor: default[\s\S]*pointer-events: none/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.game-hero-indicator[\s\S]*background: color-mix\(in srgb, var\(--surface\) 90%, transparent\)/);
  assert.match(styles, /\.game-hero-indicator--ready[\s\S]*var\(--state-success\)/);
  assert.match(styles, /\.game-hero-indicator--checking[\s\S]*var\(--state-progress\)/);
  assert.match(styles, /\.game-hero-indicator--error[\s\S]*var\(--state-error\)/);
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
