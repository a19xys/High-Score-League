const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

function rendererState({ busy = false, packs = [], status = "available-populated" } = {}) {
  return {
    busy,
    data: {
      library: {
        directory: {
          available: status.startsWith("available-"),
          configured: status !== "unconfigured",
          path: status === "unconfigured" ? null : "X:\\packs",
          reason: ["missing", "inaccessible"].includes(status) ? status : null,
        },
        packs,
        status,
        totals: { packs: packs.length },
      },
      selection: { activeInstanceKey: packs[0]?.instanceKey || null },
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
  };
}

test("dialogos de raiz rechazada explican pack e interior y ofrecen sugerencia validada", async () => {
  const { renderAppDialog } = await import(
    pathToFileURL(path.join(rendererRoot, "components", "app-dialog.js")).href
  );
  const packRoot = renderAppDialog({
    activeDialog: {
      classification: "pack-root",
      suggestedRootPath: "X:\\library",
      type: "library-root-rejected",
    },
  });
  const insidePack = renderAppDialog({
    activeDialog: {
      classification: "inside-pack",
      suggestedRootPath: "X:\\library",
      type: "library-root-rejected",
    },
  });

  assert.match(packRoot, /Has elegido la carpeta de un pack/);
  assert.match(packRoot, /Usar carpeta superior/);
  assert.match(packRoot, /data-action="use-suggested-library-root"/);
  assert.match(packRoot, /data-action="choose-other-library-root"/);
  assert.match(insidePack, /Esta carpeta forma parte de un pack/);
  assert.match(insidePack, /Usar biblioteca detectada/);
  assert.match(insidePack, /La biblioteca anterior se mantiene sin cambios|carpeta interna de un juego/);
});

test("bootstrap de tema se ejecuta antes del CSS y app reutiliza el valor normalizado", async () => {
  const [html, app, main] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "index.html"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
  ]);

  assert.doesNotMatch(html, /<html[^>]*data-theme="dark"/);
  assert.ok(html.indexOf("window.__HSL_INITIAL_THEME__") < html.indexOf("styles/tokens.css"));
  assert.match(html, /new Set\(\["light", "dark"\]\)/);
  assert.match(html, /allowedThemes\.has\(storedTheme\) \? storedTheme : "dark"/);
  assert.match(html, /document\.documentElement\.style\.colorScheme = initialTheme/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(app, /window\.__HSL_INITIAL_THEME__ === "light" \? "light" : "dark"/);
  assert.match(app, /classList\.remove\("theme-bootstrap"\)/);
  assert.match(main, /show: false/);
  assert.match(main, /once\("ready-to-show"[\s\S]*mainWindow\?\.show\(\)/);
});

test("busy no contrae filtros ni deshabilita vistas de una biblioteca valida", async () => {
  const { renderLibraryPanel } = await import(
    pathToFileURL(path.join(rendererRoot, "components", "library-panel.js")).href
  );
  const pack = {
    favoriteKey: "pack-a",
    id: "pack-a",
    instanceKey: "instance-a",
    status: "ok",
    title: "Pack A",
  };
  const html = renderLibraryPanel(rendererState({ busy: true, packs: [pack] }));

  assert.match(html, /data-action="toggle-library-filters"[^>]*aria-expanded="true"[^>]*aria-disabled="false"/);
  assert.match(html, /id="library-filter-card"/);
  assert.equal((html.match(/class="view-button[^"]*"[^>]*aria-disabled="false"/g) || []).length, 3);
  assert.match(html, /data-view="icons"[^>]*aria-pressed="true"/);
});

test("icon-window distingue icono y cover fallback con overscan compartido", async () => {
  const [{ renderPackCard }, styles, tokens] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "pack-card.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
  ]);
  const state = rendererState({ packs: [] });
  state.data.selection.activeInstanceKey = null;
  const iconPack = { id: "icon", instanceKey: "icon", icon: { url: "icon.png" }, status: "ok", title: "Icon" };
  const coverPack = { id: "cover", instanceKey: "cover", cover: { url: "cover.png" }, status: "ok", title: "Cover" };
  const iconHtml = renderPackCard(iconPack, state, "icons");
  const listHtml = renderPackCard(iconPack, state, "list");
  const fallbackHtml = renderPackCard(coverPack, state, "icons");
  const finalCss = styles.split("/* LOCAL-LAUNCHER-LIBRARY-ROOT-AND-VISUAL-POLISH-5:")[1];

  assert.match(iconHtml, /pack-card__media--icon/);
  assert.match(listHtml, /pack-card__media--icon/);
  assert.match(fallbackHtml, /pack-card__media--cover-fallback/);
  assert.match(finalCss, /\.pack-card--list \.pack-card__media,\s*\n\.pack-card--icons \.pack-card__media[\s\S]*linear-gradient/);
  assert.match(finalCss, /\.pack-card--list \.pack-card__media--icon \.pack-card__art,[\s\S]*transform: scale\(var\(--icon-art-overscan\)\)/);
  assert.match(finalCss, /\.pack-card--list \.pack-card__media--cover-fallback \.pack-card__art,[\s\S]*transform: none/);
  assert.match(tokens, /--icon-stage-base:/);
  assert.match(tokens, /--icon-stage-highlight:/);
  assert.match(tokens, /--icon-stage-shadow:/);
  assert.doesNotMatch(finalCss, /Galaga|Pac-Man|Donkey Kong|Space Invaders/);
});

test("titulo monotono, LED, ring unico y subtitulo estructural comparten primitivas", async () => {
  const [{ renderPackCard }, styles, tokens, calendar] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "pack-card.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "assets", "icons", "calendar.svg"), "utf8"),
  ]);
  const state = rendererState({ packs: [] });
  state.data.selection.activeInstanceKey = "instance-a";
  const html = renderPackCard({ id: "a", instanceKey: "instance-a", status: "ok", title: "Pack A" }, state, "icons");
  const finalCss = styles.split("/* LOCAL-LAUNCHER-LIBRARY-ROOT-AND-VISUAL-POLISH-5:")[1];
  const ledReadyValues = [...tokens.matchAll(/--led-ready:\s*([^;]+);/g)].map((match) => match[1]);

  assert.match(finalCss, /container-type: inline-size/);
  assert.match(finalCss, /font-size: clamp\(12px, 10cqi, 14px\)/);
  assert.match(finalCss, /gap: var\(--icon-card-gap\)/);
  assert.match(finalCss, /\.pack-card\[data-selected="true"\]::after,[\s\S]*box-shadow: none[\s\S]*drop-shadow/);
  assert.match(finalCss, /\.pack-card--pending:not\(\.pack-card--active\)[\s\S]*var\(--led-warning\)/);
  assert.equal(new Set(ledReadyValues).size, 1);
  assert.match(finalCss, /\.pack-card__status-dot--ok[\s\S]*var\(--led-ready\)[\s\S]*0 0 7px/);
  assert.match(html, /pack-card__status-dot--ok[^>]*aria-label="LISTO"/);
  assert.match(html, /pack-card__subtitle-icon/);
  assert.match(html, /pack-card__subtitle-text/);
  assert.match(finalCss, /\.pack-card__subtitle \{[\s\S]*display: flex[\s\S]*align-items: center/);
  assert.match(finalCss, /\.pack-card__subtitle-text[\s\S]*text-overflow: ellipsis/);
  assert.match(calendar, /viewBox="0 0 24 24"/);
  assert.match(calendar, /stroke="currentColor"/);
  assert.doesNotMatch(calendar, /512px|translateY|#f9faf9/);
});

test("IPC y renderer solo aplican la sugerencia tras una accion explicita", async () => {
  const [main, preload, app] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "preload.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
  ]);

  assert.match(main, /launcher:use-suggested-pack-directory/);
  assert.match(preload, /useSuggestedPackDirectory/);
  assert.match(app, /action === "use-suggested-library-root"[\s\S]*suggestedRootPath[\s\S]*useSuggestedPackDirectory/);
  assert.match(app, /promptForRejectedLibraryRoot/);
  assert.doesNotMatch(app, /action === "choose-pack-directory"[\s\S]{0,260}neutralizeActivePack: true/);
});
