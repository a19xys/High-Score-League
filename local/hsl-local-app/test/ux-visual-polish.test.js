const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

function libraryState(status, overrides = {}) {
  const unavailable = status === "missing" || status === "inaccessible";
  const unconfigured = status === "unconfigured";

  return {
    busy: false,
    data: {
      library: {
        directory: {
          available: !unavailable && !unconfigured,
          configured: !unconfigured,
          path: unconfigured ? null : "X:\\packs",
          reason: unavailable ? status : null,
        },
        packs: [],
        status,
        totals: { packs: 0 },
      },
      session: { hasSession: false },
    },
    libraryActivationInProgress: false,
    libraryFavoriteFilter: "all",
    libraryFiltersOpen: true,
    libraryQuery: "",
    librarySeason: "all",
    librarySortBy: "weeks",
    librarySortDirection: "asc",
    libraryStatus: "all",
    libraryView: "icons",
    pendingLibraryPackId: null,
    ...overrides,
  };
}

test("library controls follow structural availability and preserve the saved view", async () => {
  const { renderLibraryPanel } = await import(
    pathToFileURL(path.join(rendererRoot, "components", "library-panel.js")).href
  );

  for (const status of ["unconfigured", "missing", "inaccessible"]) {
    const state = libraryState(status);
    const html = renderLibraryPanel(state);

    assert.match(html, /data-action="toggle-library-filters"[^>]*aria-expanded="false"[^>]*aria-disabled="true"[^>]*disabled/);
    assert.equal((html.match(/class="view-button[^"]*"[^>]*aria-disabled="true"[^>]*disabled/g) || []).length, 3);
    assert.doesNotMatch(html, /id="library-filter-card"/);
    assert.equal(state.libraryView, "icons");
  }

  const empty = libraryState("available-empty");
  const emptyHtml = renderLibraryPanel(empty);
  assert.match(emptyHtml, /data-action="toggle-library-filters"[^>]*aria-expanded="true"[^>]*aria-disabled="false"/);
  assert.equal((emptyHtml.match(/class="view-button[^"]*"[^>]*aria-disabled="false"/g) || []).length, 3);
  assert.match(emptyHtml, /id="library-filter-card"/);
  assert.equal(empty.libraryView, "icons");

  const recovered = libraryState("available-populated");
  recovered.data.library.packs = [{
    favoriteKey: "pack-a",
    id: "pack-a",
    instanceKey: "instance-a",
    packDir: "X:\\packs\\A",
    status: "ok",
    title: "Pack A",
  }];
  recovered.data.library.totals.packs = 1;
  const recoveredHtml = renderLibraryPanel(recovered);

  assert.equal((recoveredHtml.match(/class="view-button[^"]*"[^>]*aria-disabled="false"/g) || []).length, 3);
  assert.match(recoveredHtml, /data-view="icons"[^>]*aria-pressed="true"/);
  assert.match(recoveredHtml, /id="library-filter-card"/);
});

test("dialog variants use semantic shared colors in light and dark themes", async () => {
  const [{ renderAppDialog }, styles, tokens] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "app-dialog.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
  ]);
  const html = renderAppDialog({ activeDialog: { type: "import-pack" } });

  assert.equal((html.match(/app-dialog__button--primary/g) || []).length, 2);
  assert.equal((html.match(/app-dialog__button--secondary/g) || []).length, 1);
  assert.match(styles, /\.app-dialog__button--secondary \{[\s\S]*var\(--dialog-secondary-bg\)[\s\S]*var\(--dialog-secondary-text\)/);
  assert.match(styles, /\.app-dialog__button-icon \{[\s\S]*color: currentColor/);
  assert.match(tokens, /\[data-theme="dark"\][\s\S]*--dialog-secondary-bg: #24344a/);
  assert.doesNotMatch(tokens, /--dialog-secondary-bg: #020617/);
});

test("cards share shell selection and icon-stage primitives without media shadows", async () => {
  const [{ renderPackCard }, styles, tokens] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "pack-card.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
  ]);
  const pack = {
    favoriteKey: "pack-a",
    id: "pack-a",
    instanceKey: "instance-a",
    status: "ok",
    title: "Pack A",
  };
  const state = {
    busy: false,
    data: {
      selection: { activeInstanceKey: "instance-a" },
      session: { hasSession: false },
    },
    libraryActivationInProgress: false,
    pendingLibraryPackId: null,
  };

  for (const view of ["covers", "list", "icons"]) {
    const html = renderPackCard(pack, state, view);
    assert.match(html, /data-instance-key="instance-a"/);
    assert.match(html, /data-selected="true"/);
    assert.match(html, /aria-current="true"/);
    assert.equal((html.match(/pack-card--active/g) || []).length, 1);
  }

  const polish = styles.split("/* LOCAL-LAUNCHER-UX-VISUAL-POLISH-4:")[1];
  const lightTheme = styles.split("/* WEB-LOCAL-LIGHT-THEME-SORA-PASS-1:")[1].split("/* LOCAL-LAUNCHER-UX-VISUAL-POLISH-4:")[0];

  assert.match(tokens, /--shadow-card:/);
  assert.match(tokens, /--shadow-card-hover:/);
  assert.match(tokens, /--selection-ring:/);
  assert.match(polish, /\.pack-card::after[\s\S]*border: 2px solid transparent/);
  assert.match(polish, /\.pack-card\[data-selected="true"\]::after,[\s\S]*border-color: var\(--selection-ring\)/);
  assert.match(polish, /\.pack-card--covers[\s\S]*padding: 7px 7px 0/);
  assert.match(polish, /\.pack-card--covers \.pack-card__media[\s\S]*box-shadow: none/);
  assert.match(polish, /\.pack-card--list \.pack-card__media,\s*\n\.pack-card--icons \.pack-card__media[\s\S]*background: var\(--icon-stage\)[\s\S]*box-shadow: none/);
  assert.match(polish, /\.pack-card--icons[\s\S]*padding: 8px 8px 11px/);
  assert.match(polish, /\.library-section--packs[\s\S]*scroll-padding:/);
  assert.doesNotMatch(lightTheme, /inset 0 1px 0/);
  assert.doesNotMatch(lightTheme, /\.pack-card__media img \{[\s\S]{0,100}drop-shadow/);
});
