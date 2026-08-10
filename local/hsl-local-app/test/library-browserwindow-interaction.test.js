const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_BROWSERWINDOW_TESTS === "1";

test("BrowserWindow preserves every library frame and keeps the final visual contracts", { skip: !enabled, timeout: 120_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_TRACE_VISIBLE: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  const fixtureSource = fs.readFileSync(fixture, "utf8");
  const preloadSource = fs.readFileSync(path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-preload.cjs"), "utf8");

  assert.doesNotMatch(preloadSource, /REFRESH EXPANSION|visiblePacks|let expanded/);
  assert.match(fixtureSource, /sendInputEvent\(\{ type: "mouseWheel"/);
  assert.match(fixtureSource, /sendInputEvent\(\{ type: "mouseDown"/);
  assert.match(fixtureSource, /sendInputEvent\(\{ type: "mouseUp"/);

  for (const selection of result.selections) {
    const samples = Object.fromEntries(selection.trace.map((sample) => [sample.label, sample]));
    const before = samples["A-stable"];
    assert.ok(selection.initialScrollTop > 0, `${selection.view} debe partir desplazada`);
    assert.equal(selection.flicker, false, selection.view);
    assert.equal(selection.maxScrollDelta, 0, selection.view);
    assert.deepEqual(selection.geometryTransitions, [], `${selection.view} no debe alterar geometrÃ­a`);
    assert.deepEqual(selection.identityTransitions, [], `${selection.view} no debe reemplazar nodos`);
    assert.equal(selection.trace.at(-1).scrollEvents, 0, `${selection.view} no debe emitir scroll`);
    for (const frame of selection.frameTrace) {
      assert.equal(frame.scrollTop, selection.initialScrollTop, `${selection.view} frame ${frame.frame}`);
      assert.equal(frame.identity, before.identity);
      assert.deepEqual(frame.nodes, { images: true, neighbors: true, scroller: true, target: true });
    }
    assert.equal(new Set(selection.frameTrace.map((frame) => frame.scrollHeight)).size, 1, selection.view);
    for (const sample of selection.trace) {
      assert.equal(sample.scrollTop, before.scrollTop);
      assert.deepEqual(sample.nodes, { images: true, neighbors: true, scroller: true, target: true });
    }
    for (const label of ["B-mousedown-focus", "D-pending", "E-accepted", "F-refresh"]) {
      assert.equal(samples[label].focusedInstanceKey, selection.targetInstanceKey, `${selection.view} ${label}`);
    }
    for (const label of ["E-accepted", "F-refresh", "G-one-frame", "G-three-frames"]) {
      const sample = samples[label];
      assert.equal(sample.detailScrollTop, 0);
    }
  }
  assert.equal(result.samePackDetail, 120);
  for (const theme of [result.visuals.dark, result.visuals.light]) {
    assert.deepEqual(theme.active, {
      ariaCurrent: "true",
      ariaDisabled: null,
      role: null,
      selectable: false,
      favoriteDisabled: false,
    });
    for (const favorite of [theme.favorite.active, theme.favorite.other]) {
      assert.equal(favorite.filter, "none");
      assert.equal(favorite.opacity, "1");
      assert.notEqual(favorite.color, "rgba(0, 0, 0, 0)");
    }
    assert.deepEqual(theme.selectedBadge.active, theme.selectedBadge.other);
    assert.equal(theme.badges.LISTO.color, theme.semanticColors.success);
    assert.equal(theme.badges.LEGACY.color, theme.semanticColors.warning);
    assert.equal(theme.badges.AVISO.color, theme.semanticColors.warning);
    assert.equal(theme.badges["REQUIERE ATENCION"].color, theme.semanticColors.error);
    assert.notEqual(theme.badges.LISTO.background, theme.badges.LEGACY.background);
    assert.notEqual(theme.badges.LEGACY.background, theme.badges["REQUIERE ATENCION"].background);
  }
  assert.deepEqual(result.rows.map(({ columns }) => columns), [2, 3, 4]);
  result.rows.forEach(({ cards }) => {
    cards.forEach((card) => {
      assert.ok(Math.abs(card.cardHeight - cards[0].cardHeight) <= 1);
      assert.ok(Math.abs(card.titleCenter - card.bodyCenter) <= 1, card.title);
    });
    assert.ok(cards.some((card) => card.lines === 1));
    assert.ok(cards.some((card) => card.lines === 2));
  });

  assert.equal(result.signals.pack.width, "14px");
  assert.equal(result.signals.pack.height, "14px");
  assert.equal(result.signals.pack.childCount, 0);
  assert.equal(result.signals.connection.childCount, 0);
  assert.equal(result.signals.pack.shadow, "none");
  assert.equal(result.signals.connection.shadow, "none");
  assert.match(result.signals.pack.border, /^2px solid /);
  assert.match(result.signals.connection.border, /^0px none /);
  assert.equal(result.signals.pack.pseudoAfter, "none");
  for (const tone of ["success", "warning", "error", "info", "neutral"]) {
    assert.equal(result.hostileSignals.dark[tone].fill, result.hostileSignals.light[tone].fill, tone);
    for (const theme of ["dark", "light"]) {
      const signal = result.hostileSignals[theme][tone];
      assert.equal(signal.childCount, 0, `${theme} ${tone}`);
      assert.ok(signal.fill !== signal.backdrop || signal.border !== signal.backdrop, `${theme} ${tone}`);
    }
    assert.equal(result.hostileSignals.light[tone].border, "rgb(255, 255, 255)");
    assert.equal(result.hostileSignals.dark[tone].border, "rgb(15, 23, 42)");
  }

  for (const metric of result.filters.results) {
    assert.ok(metric.before > 0, metric.label);
    assert.equal(metric.after, 0, metric.label);
  }
  for (const metric of result.filters.presentation) {
    assert.ok(metric.before > 0, metric.label);
    assert.ok(Math.abs(metric.after - metric.before) <= 1, metric.label);
  }

  for (const [name, metric] of Object.entries(result.detail)) {
    assert.equal(metric.spacerDisplay, "block", name);
    assert.equal(metric.spacerHeight, "16px", name);
    assert.equal(metric.documentOverflowX, 0, name);
    assert.equal(metric.documentOverflowY, 0, name);
    assert.ok(metric.detailWidth >= 540, name);
    if (metric.hasOverflow) {
      assert.equal(metric.atMaximum, true, name);
      assert.ok(metric.bottomGap >= 15 && metric.bottomGap <= 17, `${name}: ${metric.bottomGap}`);
      assert.ok(metric.terminalExtent >= 15 && metric.terminalExtent <= 17, `${name}: ${metric.terminalExtent}`);
    }
  }
  assert.equal(result.detail.comfortable.hasOverflow, false);
  assert.equal(result.detail.minimum.hasOverflow, true);
  assert.equal(result.detail.minimum.outerBounds.width, 1200);
  assert.equal(result.detail.minimum.outerBounds.height, 620);
  assert.equal(result.detail.userLike.hasOverflow, true);

  for (const [name, metric] of Object.entries(result.icons)) {
    assert.ok(metric.alphaBounds.left <= metric.alphaBounds.right, name);
    assert.ok(metric.alphaBounds.top <= metric.alphaBounds.bottom, name);
    assert.ok(Math.abs(metric.projected16.x) <= 1, `${name} x=${metric.projected16.x}`);
    assert.ok(Math.abs(metric.projected16.y) <= 1, `${name} y=${metric.projected16.y}`);
  }
  result.heroAndDrawers.closeButtons.forEach((offset) => {
    assert.ok(Math.abs(offset.x) <= 1);
    assert.ok(Math.abs(offset.y) <= 1);
    assert.equal(offset.fallbackDisplay, "none");
    assert.equal(offset.fallbackText, "");
    assert.equal(offset.imageComplete, true);
    assert.equal(offset.imageSource, "./assets/icons/close.svg");
    assert.match(offset.glyphMask, /close\.svg/);
    assert.equal(offset.modalTop, 32);
    assert.equal(offset.drawerTop, 32);
    assert.equal(offset.modalBottom, offset.viewportHeight);
    assert.equal(offset.drawerBottom, offset.viewportHeight);
    assert.equal(offset.buttonHeight, 38);
    assert.equal(offset.buttonWidth, 38);
    assert.equal(offset.iconHeight, 18);
    assert.equal(offset.iconWidth, 18);
    assert.equal(offset.glyphTransform, "matrix(1, 0, 0, 1, 0, 0)");
  });
  assert.deepEqual(result.heroAndDrawers.closeButtons.map(({ drawer }) => drawer), ["settings", "activity"]);
  for (const icon of Object.values(result.heroAndDrawers.headerIcons)) {
    assert.equal(icon.buttonHeight, 38);
    assert.equal(icon.buttonWidth, 38);
    assert.equal(icon.iconHeight, 18);
    assert.equal(icon.iconWidth, 18);
    assert.equal(icon.glyphTransform, "matrix(1, 0, 0, 1, 0, 0)");
  }
  assert.ok(result.heroAndDrawers.expanded.laneWidth > 213);
  result.heroAndDrawers.expanded.indicators.forEach((indicator) => {
    assert.ok(indicator.width > 40);
    assert.ok(indicator.labelWidth > 1);
  });
  assert.ok(result.heroAndDrawers.compact.laneWidth <= 213);
  result.heroAndDrawers.compact.indicators.forEach((indicator) => {
    assert.ok(Math.abs(indicator.width - 40) <= 1);
    assert.ok(indicator.labelWidth <= 1);
  });

  assert.deepEqual(result.accounts.requiresLogin, {
    busyOverlaySeen: false,
    calls: 0,
    controlsDisabled: false,
    email: "relogin@example.test",
    formVisible: true,
    menuOpen: true,
    message: "Inicia sesiÃ³n de nuevo para esta cuenta.",
  });
  assert.deepEqual(result.accounts.unexpectedRelogin, {
    busyOverlaySeen: true,
    calls: 1,
    email: "expired@example.test",
    formVisible: true,
    menuOpen: true,
  });
  assert.deepEqual(result.accounts.addAccount, {
    email: "",
    formVisible: true,
    menuOpen: true,
  });
  assert.equal(result.accounts.valid.busyOverlaySeen, true);
  assert.equal(result.accounts.valid.calls, 1);
  assert.equal(result.accounts.valid.menuOpen, false);
  assert.match(result.accounts.valid.sessionTitle, /valid@example\.test/);

  assert.equal(result.chrome.applicationMenu, null);
  for (const theme of [result.chrome.dark, result.chrome.light]) {
    assert.equal(theme.dragRegion, "drag");
    assert.equal(theme.height, 32);
    assert.equal(theme.iconLoaded, true);
    assert.equal(theme.title, "High Score League Launcher");
    assert.equal(theme.titleContained, true);
    assert.equal(theme.titleLineHeight, "18px");
    assert.equal(theme.borderBottomWidth, "1px");
    assert.equal(theme.safeArea.height, 32);
    assert.equal(theme.before.pointerEvents, "none");
    assert.equal(theme.after.pointerEvents, "none");
  }
  assert.notEqual(result.chrome.dark.background, result.chrome.light.background);
  assert.equal(result.chrome.light.after.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(result.chrome.light.before.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.doesNotMatch(result.chrome.light.after.boxShadow, /0px 1px/);
  assert.doesNotMatch(result.chrome.light.before.boxShadow, /0px 1px/);
  assert.equal(result.chrome.rails.header.left, result.chrome.rails.main.left);
  assert.equal(result.chrome.rails.header.right, result.chrome.rails.main.right);
  assert.equal(result.chrome.rails.header.beforeBackground, result.chrome.rails.main.beforeBackground);
  assert.equal(result.chrome.rails.header.afterBackground, result.chrome.rails.main.afterBackground);
  assert.equal(result.chrome.rails.header.beforePointerEvents, "none");
  assert.equal(result.chrome.rails.header.afterPointerEvents, "none");
  assert.ok(result.chrome.rails.bodyScrollWidth <= result.chrome.rails.innerWidth);
  if (process.platform === "win32") {
    assert.deepEqual(result.chrome.hoverCaptures.map(({ name }) => name), ["minimize", "maximize", "close"]);
    result.chrome.hoverCaptures.forEach(({ cellWidth, clusterWidth, controlsOnRight }) => {
      assert.equal(controlsOnRight, true);
      assert.ok(clusterWidth > 0);
      assert.ok(Math.abs(cellWidth * 3 - clusterWidth) < 0.01);
    });
    assert.match(result.chrome.light.after.backgroundImage, /linear-gradient[\s\S]*linear-gradient/);
    if (result.chrome.nativeActions) {
      assert.deepEqual(result.chrome.nativeActions, {
        closeActivated: true,
        maximized: true,
        minimized: true,
      });
    }
  }

  for (const direction of [result.footer.bottomResize, result.footer.topResize]) {
    direction.forEach(({ dom }) => {
      assert.equal(dom.shell.bottom, dom.innerHeight);
      assert.equal(dom.footer.bottom, dom.innerHeight);
      assert.equal(dom.footer.height, 34);
    });
  }
});
