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
      issue: "rejected-candidate",
      suggestedRootPath: "X:\\library",
      type: "library-location",
    },
  });
  const insidePack = renderAppDialog({
    activeDialog: {
      classification: "inside-pack",
      issue: "rejected-candidate",
      suggestedRootPath: "X:\\library",
      type: "library-location",
    },
  });

  assert.match(packRoot, /Has elegido la carpeta de un pack/);
  assert.match(packRoot, /Detectar packs/);
  assert.match(packRoot, /data-action="detect-library-location"/);
  assert.match(packRoot, /data-action="choose-library-location"/);
  assert.match(insidePack, /Esta carpeta forma parte de un pack/);
  assert.match(insidePack, /Detectar packs/);
  assert.match(insidePack, /Estás dentro de un pack[\s\S]*La Biblioteca anterior se mantiene/);
});

test("bootstrap de tema se ejecuta antes del CSS y app reutiliza el valor normalizado", async () => {
  const [html, bootstrap, app, main] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "index.html"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "theme-bootstrap.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
  ]);

  assert.doesNotMatch(html, /<html[^>]*data-theme="dark"/);
  assert.ok(html.indexOf("theme-bootstrap.js") < html.indexOf("styles/tokens.css"));
  assert.match(bootstrap, /new Set\(\["light", "dark"\]\)/);
  assert.match(bootstrap, /window\.hslLauncher\?\.startupTheme/);
  assert.match(bootstrap, /resolveThemeBootstrap/);
  assert.match(bootstrap, /allowedThemes\.has\(bootstrap\.effectiveTheme\) \? bootstrap\.effectiveTheme : "dark"/);
  assert.match(bootstrap, /document\.documentElement\.style\.colorScheme = initialTheme/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(app, /window\.__HSL_INITIAL_THEME__ === "light" \? "light" : "dark"/);
  assert.match(app, /classList\.remove\("theme-bootstrap"\)/);
  assert.match(main, /show: false/);
  assert.match(main, /backgroundColor: themeBackgroundColor\(theme\.effectiveTheme\)/);
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

test("la lista no conserva el extent lock y el detalle termina con un spacer real de 16 px", async () => {
  const [{ renderLibraryPacks }, styles] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "library-panel.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  const html = renderLibraryPacks(rendererState({ packs: [] }));

  assert.doesNotMatch(html, /library-packs-content/);
  assert.doesNotMatch(styles, /library-packs-min-block-size|\.library-packs-content/);
  assert.match(styles, /\.game-scroll\s*\{[^}]*gap: 0[^}]*grid-auto-rows: max-content[^}]*padding: 18px 20px 0/);
  assert.match(styles, /\.game-scroll::after\s*\{[^}]*content: ""[^}]*display: block[^}]*height: 16px[^}]*flex: 0 0 16px/);
});

test("Lista e Iconos comparten presentación alpha-aware para iconos y cover fallback", async () => {
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
  assert.match(finalCss, /\.pack-card--list \.pack-card__media\[data-art-presentation="transparent"\] \.pack-card__art,\s*\n\.pack-card--icons \.pack-card__media\[data-art-presentation="transparent"\] \.pack-card__art\s*\{[^}]*object-fit: contain[^}]*filter: var\(--icon-art-edge\)[^}]*padding: 4%/);
  assert.match(finalCss, /\.pack-card--list \.pack-card__media\[data-art-presentation="opaque"\] \.pack-card__art,\s*\n\.pack-card--icons \.pack-card__media\[data-art-presentation="opaque"\] \.pack-card__art\s*\{[^}]*object-fit: cover[^}]*filter: none[^}]*padding: 0/);
  assert.match(finalCss, /\.pack-card--list \.pack-card__media\[data-art-presentation="unknown"\] \.pack-card__art,\s*\n\.pack-card--icons \.pack-card__media\[data-art-presentation="unknown"\] \.pack-card__art\s*\{[^}]*object-fit: contain[^}]*padding: 10%/);
  assert.match(tokens, /--icon-stage-base:/);
  assert.match(tokens, /--icon-stage-highlight:/);
  assert.match(tokens, /--icon-stage-shadow:/);
  assert.match(tokens, /--icon-art-edge:/);
  assert.doesNotMatch(`${styles}\n${tokens}`, /icon-art-overscan/);
  assert.doesNotMatch(finalCss, /pack-card__media--(?:icon|cover-fallback)[^}]*object-fit|pack-card__media--(?:icon|cover-fallback)[^}]*padding/);
  assert.doesNotMatch(finalCss, /Galaga|Pac-Man|Donkey Kong|Space Invaders/);
});

test("titulo monotono, signal beacon, ring unico y subtitulo estructural comparten primitivas", async () => {
  const [{ renderPackCard }, styles, tokens, calendar, header, gamePanel, primitives] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "pack-card.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "styles", "tokens.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "assets", "icons", "calendar.svg"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "game-panel.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "status-primitives.js"), "utf8"),
  ]);
  const state = rendererState({ packs: [] });
  state.data.selection.activeInstanceKey = "instance-a";
  const html = renderPackCard({
    id: "a",
    instanceKey: "instance-a",
    status: "ok",
    title: "Pack A",
    weekId: "week-a",
    weekCapability: { publicState: "active" },
  }, state, "icons");
  const finalCss = styles.split("/* LOCAL-LAUNCHER-LIBRARY-ROOT-AND-VISUAL-POLISH-5:")[1];

  assert.match(finalCss, /container-type: inline-size/);
  assert.match(finalCss, /font-size: clamp\(12px, 10cqi, 14px\)/);
  assert.match(finalCss, /gap: var\(--icon-card-gap\)/);
  assert.match(finalCss, /\.pack-card\[data-selected="true"\]::after,[\s\S]*box-shadow: none[\s\S]*drop-shadow/);
  assert.match(finalCss, /\.pack-card--pending:not\(\.pack-card--active\)[\s\S]*var\(--state-warning\)/);
  assert.doesNotMatch(tokens, /--led-(?:ready|warning|error|outline)/);
  assert.match(primitives, /export function renderStatusBeacon\(tone, options = \{\}\)/);
  assert.match(finalCss, /\.status-beacon\s*\{[^}]*box-sizing: border-box[^}]*width: 14px[^}]*height: 14px[^}]*border: 0[^}]*background: currentColor[^}]*box-shadow: none/);
  assert.match(finalCss, /\.status-beacon--pack\s*\{[^}]*border: 2px solid #fff/);
  assert.match(finalCss, /html\[data-theme="dark"\] \.status-beacon--pack\s*\{[^}]*border-color: var\(--background\)/);
  assert.doesNotMatch(finalCss, /\.status-beacon__core/);
  assert.doesNotMatch(finalCss, /\.status-beacon::after|inset 0 1px 1px|var\(--led-/);
  assert.match(finalCss, /\.status-beacon--success[\s\S]*color: var\(--signal-success\)/);
  assert.match(finalCss, /\.status-beacon--warning[\s\S]*color: var\(--signal-warning\)/);
  assert.match(finalCss, /\.status-beacon--error[\s\S]*color: var\(--signal-error\)/);
  assert.match(html, /status-beacon status-beacon--success status-beacon--pack pack-card__status-dot[^>]*aria-label="ACTIVA"/);
  assert.match(header, /renderStatusBeacon\(signalTone, \{ className: "connection-dot", decorative: true, variant: "connection" \}\)/);
  assert.match(tokens, /:root[\s\S]*--signal-success: #22e36f[\s\S]*--signal-warning: #ffc62e[\s\S]*--signal-error: #ff4d5f/);
  const darkTokens = tokens.slice(tokens.indexOf('[data-theme="dark"]'));
  assert.doesNotMatch(darkTokens, /--signal-(?:success|warning|error|info|neutral):/);
  assert.match(html, /pack-card__subtitle-icon/);
  assert.match(html, /pack-card__subtitle-icon text-companion-icon/);
  assert.match(gamePanel, /game-week-icon text-companion-icon/);
  assert.match(html, /pack-card__subtitle-text/);
  assert.match(finalCss, /\.pack-card__subtitle \{[\s\S]*display: flex[\s\S]*align-items: baseline/);
  assert.match(finalCss, /\.ui-icon\.text-companion-icon\s*\{[^}]*display: inline-block[^}]*inline-size: 1\.16cap[^}]*block-size: 1\.16cap[^}]*flex: 0 0 1\.16cap[^}]*vertical-align: baseline/);
  assert.match(styles, /\.game-week-subtitle\s*\{[^}]*align-items: baseline/);
  assert.match(finalCss, /\.pack-card__subtitle-text[\s\S]*text-overflow: ellipsis/);
  assert.match(finalCss, /\.pack-card--icons \.pack-card__body\s*\{[^}]*display: flex[^}]*align-items: stretch[^}]*justify-content: center/);
  assert.match(finalCss, /\.pack-card--icons \.pack-card__text\s*\{[^}]*display: flex[^}]*height: auto[^}]*align-self: stretch[^}]*flex: 1 1 auto[^}]*flex-direction: column[^}]*justify-content: center/);
  const calendarViewBox = calendar.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(calendarViewBox);
  assert.equal(calendarViewBox[1], calendarViewBox[2]);
  assert.doesNotMatch(finalCss, /(?:pack-card__subtitle-icon|game-week-icon)[^}]*?(?:translateY|top:|bottom:)/);
});

test("pack activo conserva current sin fingir disabled y los estados usan la autoridad canonica", async () => {
  const [{ renderPackCard, packCardTestApi }, styles] = await Promise.all([
    import(pathToFileURL(path.join(rendererRoot, "components", "pack-card.js")).href),
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
  ]);
  const state = rendererState({ packs: [] });
  state.data.selection.activeInstanceKey = "active-instance";
  state.data.session.hasSession = true;
  const activePack = {
    favorite: true,
    favoriteKey: "active",
    id: "active",
    instanceKey: "active-instance",
    status: "ok",
    title: "Activo",
  };
  const activeHtml = renderPackCard(activePack, state, "covers");

  assert.match(activeHtml, /data-selected="true" aria-current="true"/);
  assert.doesNotMatch(activeHtml, /aria-disabled="true"|data-action="use-library-pack"|role="button"|tabindex="0"/);
  assert.match(activeHtml, /data-action="toggle-library-favorite"[^>]*aria-pressed="true"/);
  assert.doesNotMatch(activeHtml.match(/<button class="favorite-slot[\s\S]*?<\/button>/)?.[0] || "", /disabled/);

  assert.deepEqual(
    [
      packCardTestApi.statusMeta({ status: "ok", weekCapability: { publicState: "active" }, weekId: "week-1" }),
      packCardTestApi.statusMeta({ deprecated: true, status: "ok", weekCapability: { publicState: "inactive" }, weekId: "week-2" }),
      packCardTestApi.statusMeta({ status: "warning", weekCapability: { publicState: "closed" }, weekId: "week-3" }),
      packCardTestApi.statusMeta({ status: "ok" }),
      packCardTestApi.statusMeta({ status: "ok", weekId: "week-4" }),
      packCardTestApi.statusMeta({ status: "error" }),
    ].map(({ className, label }) => [className, label]),
    [
      ["week-status--ready", "ACTIVA"],
      ["week-status--warning", "INACTIVA"],
      ["week-status--closed", "CERRADA"],
      ["week-status--warning", "SIN VINCULAR"],
      ["week-status--unknown", "SIN DATOS"],
      ["week-status--error", "REQUIERE ATENCION"],
    ],
  );
  assert.match(styles, /\.pack-card__status \.week-status-badge\.week-status--ready\s*\{[^}]*var\(--state-success\)[^}]*var\(--state-success-bg\)[^}]*color: var\(--state-success\)/);
  assert.match(styles, /\.pack-card__status \.week-status-badge\.week-status--closed\s*\{[^}]*var\(--state-warning-bg\)[^}]*color: var\(--state-warning\)/);
  assert.match(styles, /\.pack-card__status \.week-status-badge\.week-status--unknown\s*\{[^}]*var\(--surface\)[^}]*color: var\(--text-muted\)/);
  assert.match(styles, /\.pack-card__status \.week-status-badge\.week-status--error\s*\{[^}]*var\(--state-error\)[^}]*var\(--state-error-bg\)[^}]*color: var\(--state-error\)/);
});

test("controles neutros usan solo borde y contenido azules sin alterar fondos ni seleccionados", async () => {
  const [styles, header, gamePanel] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "game-panel.js"), "utf8"),
  ]);
  const marker = "LOCAL-PRE-BETA-HERO-HOVER-LOGO-BADGES-4V.3D";
  const markerIndex = styles.indexOf(marker);
  const neutralHoverCss = styles.slice(markerIndex, styles.indexOf('html:not([data-theme="dark"]) .app-dialog__button', markerIndex));
  const lightHoverRule = styles.match(/html:not\(\[data-theme="dark"\]\) \.library-control-button:not\(\.library-filter-toggle--open\):hover:not\(:disabled\),([\s\S]*?)\n\}/)?.[0] || "";
  const packRules = [...styles.matchAll(/(?:^|\n)\.pack-card \{([^}]*)\}/g)];
  const finalPackRule = packRules.at(-1)?.[1] || "";
  const packTransitionRules = [...styles.matchAll(/([^{}]*\.pack-card[^{}]*)\{([^{}]*transition:[^{}]*)\}/g)];

  assert.notEqual(markerIndex, -1);
  assert.match(header, /class="theme-button theme-button--icon"[^>]*data-action="toggle-theme"[\s\S]*className: "button-icon theme-icon"/);
  assert.match(header, /class="theme-button theme-button--icon"[^>]*data-action="show-settings"/);
  assert.match(styles, /\.theme-icon\.ui-icon\s*\{[\s\S]*?color: currentColor/);
  assert.match(styles, /\.theme-icon\.ui-icon--moon\s*\{[\s\S]*?color: currentColor/);
  assert.match(styles, /\.theme-icon\.ui-icon--sun\s*\{[\s\S]*?color: currentColor/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.theme-button:hover:not\(:disabled\)[\s\S]*?color: var\(--circuit\)/);
  assert.match(styles, /button:focus-visible,[\s\S]*?outline: 2px solid var\(--circuit\)/);

  assert.match(neutralHoverCss, /\.theme-button/);
  assert.match(neutralHoverCss, /\.library-control-button:not\(\.library-filter-toggle--open\)/);
  assert.match(neutralHoverCss, /\.view-button:not\(\.view-button--active\)/);
  assert.match(neutralHoverCss, /\.secondary-action,/);
  assert.doesNotMatch(neutralHoverCss, /\.secondary-action:not\(\.primary-action-tile\)/);
  assert.match(gamePanel, /actions\.practice, \{ className: "secondary-action primary-action-tile action-tile" \}/);
  assert.match(gamePanel, /actions\.manual, \{ className: "secondary-action compact-action action-tile" \}/);
  assert.match(gamePanel, /actions\.ranking, \{ className: "secondary-action compact-action action-tile" \}/);
  assert.match(gamePanel, /actions\.competition, \{ className: "play-button action-tile" \}/);
  assert.match(neutralHoverCss, /\.tool-button:not\(\.account-primary\):not\(\[data-action="logout"\]\)/);
  assert.match(neutralHoverCss, /\.app-dialog__button--secondary/);
  assert.match(neutralHoverCss, /:not\(\[aria-disabled="true"\]\):not\(\[aria-pressed="true"\]\):not\(\[aria-expanded="true"\]\)/);
  assert.match(neutralHoverCss, /:not\(\[data-severity="error"\]\):not\(\[data-severity="success"\]\)/);
  assert.match(neutralHoverCss, /transition: none/);
  assert.match(neutralHoverCss, /border-color: var\(--circuit\)/);
  assert.match(neutralHoverCss, /color: var\(--circuit\)/);
  assert.match(neutralHoverCss, /:hover :is\(\.ui-icon:not\(\.action-icon\), \.action-button-label, small\)[\s\S]*?color: currentColor/);
  assert.match(neutralHoverCss, /\.secondary-action \.action-icon\.ui-icon\s*\{[\s\S]*?color: var\(--circuit\)/);
  assert.doesNotMatch(neutralHoverCss, /:hover :is\(\.ui-icon, \.action-button-label, small\)/);
  assert.match(styles, /\.secondary-action,\s*\n\.tool-button\s*\{[\s\S]*?transition: transform 0\.16s ease, opacity 0\.16s ease/);
  assert.doesNotMatch(styles, /\.secondary-action,\s*\n\.tool-button\s*\{[^}]*transition:[^;]*(?:border-color|\bcolor\b)/);
  assert.doesNotMatch(neutralHoverCss, /background:|filter:|brightness|play-button|connection-refresh|favorite-slot|account-forget-button|pack-card/);
  assert.match(lightHoverRule, /border-color: var\(--circuit\)/);
  assert.match(lightHoverRule, /color: var\(--circuit\)/);
  assert.doesNotMatch(lightHoverRule, /background:|filter:|brightness/);
  assert.doesNotMatch(styles, /\.view-button--active:hover|\.library-control-button\.library-filter-toggle--open:hover|\.library-favorite-filter-button--active:hover/);
  assert.match(styles, /\.view-button--active\s*\{[\s\S]*?background:/);
  assert.match(styles, /\.library-control-button\.library-filter-toggle--open\s*\{[\s\S]*?background:/);
  assert.match(styles, /\.library-favorite-filter-button--active\s*\{[\s\S]*?background:/);

  assert.match(finalPackRule, /transition: box-shadow 0\.16s ease/);
  assert.doesNotMatch(finalPackRule, /transition:[^;]*(?:background|border-color|\bcolor\b)/);
  assert.equal(packTransitionRules.length, 1);
  const packTransition = packTransitionRules[0][2].match(/transition:\s*([^;]+)/)?.[1] || "";
  assert.doesNotMatch(packTransition, /background(?:-color)?|border-color|(?:^|[, ])color\s/);
  assert.match(styles, /\.pack-card\[role="button"\]:hover[\s\S]*?box-shadow: var\(--shadow-card-hover\)/);
});

test("IPC y renderer solicitan detección y dejan la validación en main/service", async () => {
  const [main, preload, app] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "preload.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
  ]);

  assert.match(main, /launcher:detect-library-location/);
  assert.match(preload, /detectLibraryLocation[\s\S]*launcher:detect-library-location/);
  assert.match(app, /action === "detect-library-location"[\s\S]*detectLibraryLocation\(libraryLocationDialog\?\.candidatePath/);
  assert.match(app, /promptForRejectedLibraryRoot/);
  assert.doesNotMatch(app, /action === "choose-pack-directory"[\s\S]{0,260}neutralizeActivePack: true/);
});
