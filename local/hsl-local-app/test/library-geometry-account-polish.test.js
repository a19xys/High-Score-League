const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

async function geometryModule() {
  return import(pathToFileURL(path.join(rendererRoot, "library-geometry.js")).href);
}

test("icon geometry produces two, three and four complete columns at canonical widths", async () => {
  const {
    LIBRARY_SIDEBAR_DEFAULT,
    LIBRARY_SIDEBAR_MAX,
    LIBRARY_SIDEBAR_MIN,
    libraryIconLayout,
  } = await geometryModule();

  assert.equal(libraryIconLayout(LIBRARY_SIDEBAR_MIN).columns, 2);
  assert.equal(libraryIconLayout(LIBRARY_SIDEBAR_DEFAULT).columns, 3);
  assert.equal(libraryIconLayout(LIBRARY_SIDEBAR_MAX).columns, 4);

  for (const width of [LIBRARY_SIDEBAR_MIN, LIBRARY_SIDEBAR_DEFAULT, LIBRARY_SIDEBAR_MAX]) {
    const layout = libraryIconLayout(width);
    assert.ok(layout.occupiedWidth <= layout.availableWidth);
    assert.ok(layout.remainingWidth >= 0);
  }
});

test("maximum width admits no partial fifth column with classic or overlay scrollbars", async () => {
  const {
    LIBRARY_SIDEBAR_MAX,
    LIBRARY_ICON_COLUMN_GAP,
    LIBRARY_ICON_TILE_MIN,
    libraryIconLayout,
  } = await geometryModule();
  const fifthColumnWidth = 5 * LIBRARY_ICON_TILE_MIN + 4 * LIBRARY_ICON_COLUMN_GAP;

  for (const scrollbarWidth of [0, 12, 15, 17]) {
    const layout = libraryIconLayout(LIBRARY_SIDEBAR_MAX, { scrollbarWidth });
    assert.equal(layout.columns, 4);
    assert.ok(layout.availableWidth < fifthColumnWidth);
  }
});

test("the four-column breakpoint is monotonic and does not oscillate by one pixel", async () => {
  const { libraryIconLayout, minimumSidebarWidthForIconColumns } = await geometryModule();
  const threshold = minimumSidebarWidthForIconColumns(4);

  assert.equal(libraryIconLayout(threshold - 1).columns, 3);
  assert.equal(libraryIconLayout(threshold).columns, 4);
  assert.equal(libraryIconLayout(threshold + 1).columns, 4);
});

test("sidebar clamp preserves the documented UI bounds and Home default", async () => {
  const {
    clampLibrarySidebarWidth,
    LIBRARY_SIDEBAR_DEFAULT,
    LIBRARY_SIDEBAR_MAX,
    LIBRARY_SIDEBAR_MIN,
  } = await geometryModule();

  assert.equal(clampLibrarySidebarWidth(-1), LIBRARY_SIDEBAR_MIN);
  assert.equal(clampLibrarySidebarWidth(9999), LIBRARY_SIDEBAR_MAX);
  assert.equal(clampLibrarySidebarWidth(Number.NaN), LIBRARY_SIDEBAR_DEFAULT);
  assert.equal(clampLibrarySidebarWidth(439.6), LIBRARY_SIDEBAR_DEFAULT);
});

test("the minimum window keeps a bounded detail region even at maximum sidebar width", async () => {
  const { GAME_DETAIL_MIN_WIDTH, LIBRARY_RESIZER_WIDTH, LIBRARY_SIDEBAR_MAX } = await geometryModule();
  const minimumWindowWidth = 1180;
  const requiredLayoutWidth = LIBRARY_SIDEBAR_MAX + LIBRARY_RESIZER_WIDTH + GAME_DETAIL_MIN_WIDTH;

  assert.equal(requiredLayoutWidth, 1148);
  assert.ok(requiredLayoutWidth < minimumWindowWidth);
});

test("winning library CSS removes duplicate padding and keeps square, bounded icon tracks", async () => {
  const styles = await fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8");
  const outerScrollRule = styles.match(/\.library-scroll\s*\{[^}]*overflow: hidden;[^}]*padding: 0;[^}]*\}/)?.[0] || "";
  const finalPackViewport = styles.slice(styles.lastIndexOf(".library-section--packs {"));

  assert.match(outerScrollRule, /padding: 0/);
  assert.match(finalPackViewport, /overflow-x: hidden/);
  assert.match(finalPackViewport, /padding: 6px 6px 14px/);
  assert.match(styles, /scrollbar-gutter: stable/);
  assert.match(styles, /--library-icon-tile-min: 122px/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fill, minmax\(var\(--library-icon-tile-min\), 1fr\)\)/);
  assert.match(styles, /\.pack-card--icons \.pack-card__media\s*\{[^}]*aspect-ratio: 1 \/ 1/);
  assert.doesNotMatch(finalPackViewport.split(".pack-card {")[0], /overflow-x: auto/);
});

test("covers and list retain independent grid contracts", async () => {
  const styles = await fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8");

  assert.match(styles, /\.library-pack-grid--covers\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.library-pack-grid--list\s*\{[\s\S]*?grid-template-columns: 1fr/);
});

test("library heading and controls form a compact sequence without an empty spacer", async () => {
  const [panel, styles] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "components", "library-panel.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  const finalPanelRule = [...styles.matchAll(/\.library-panel\s*\{([^}]*)\}/g)].at(-1)?.[1] || "";

  assert.match(panel, /data-render-region="library-heading"[\s\S]*data-render-region="library-controls"[\s\S]*data-render-region="library-packs"/);
  assert.doesNotMatch(panel, /library-spacer|aria-hidden="true"[^>]*library/);
  assert.match(styles, /\.library-panel\s*\{\s*gap: 6px;\s*padding: 12px;/);
  assert.match(styles, /\.library-panel \.panel-heading\s*\{[^}]*margin-bottom: 0/);
  assert.doesNotMatch(finalPanelRule, /justify-content:\s*space-between|min-height:\s*[1-9][0-9]{2}px/);
});

test("forget-account uses the shared rounded blue interaction without layout shifts", async () => {
  const [styles, tokens, header] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
  ]);
  const normal = styles.match(/\.account-forget-button\s*\{([^}]*)\}/)?.[1] || "";
  const interaction = styles.match(/\.account-forget-button:hover,\s*\n\.account-forget-button:focus-visible\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(normal, /width: 30px/);
  assert.match(normal, /height: 30px/);
  assert.match(normal, /border-radius: var\(--control-radius\)/);
  assert.match(interaction, /var\(--circuit\)/);
  assert.match(interaction, /var\(--surface-muted\)/);
  assert.doesNotMatch(interaction, /--error|#[a-f\d]{3,8}|width:|height:/i);
  assert.match(styles, /\.account-forget-button:focus-visible\s*\{[\s\S]*?outline: 2px solid color-mix\(in srgb, var\(--circuit\)/);
  assert.match(styles, /\.account-forget-button \.ui-icon\s*\{[\s\S]*?color: currentColor/);
  assert.match(tokens, /--control-radius: 8px/);
  assert.equal((tokens.match(/--circuit:/g) || []).length, 2);
  assert.match(header, /title="Olvidar cuenta" aria-label="Olvidar cuenta"/);
  assert.match(header, /type="button" data-action="remove-known-account"/);
});

test("forget-account keeps an accessible confirmation and a cancel-first focus path", async () => {
  const [{ renderAppDialog }, app] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "app-dialog.js")).href),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
  ]);
  const html = renderAppDialog({
    activeDialog: {
      email: "fixture@example.test",
      type: "forget-account",
      userId: "fixture-user",
    },
  });

  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /¿Olvidar esta cuenta\?/);
  assert.match(html, /Las puntuaciones y colas locales se conservarán/);
  assert.match(html, /data-action="close-dialog" data-dialog-initial-focus/);
  assert.match(html, /data-action="confirm-forget-account"/);
  assert.match(app, /action === "remove-known-account"[\s\S]*activeDialog: \{[\s\S]*type: "forget-account"[\s\S]*userId/);
  assert.match(app, /action === "confirm-forget-account"[\s\S]*window\.hslLauncher\.removeKnownAccount\(userId\)/);
  assert.match(app, /current\.accountMenuOpen[\s\S]*!target\.closest\("\[data-dialog\]"\)[\s\S]*!target\.closest\("\[data-account-menu\]"\)/);
  assert.match(app, /closing && dialogReturnFocus\?\.isConnected[\s\S]*focus\(\{ preventScroll: true \}\)/);
});
