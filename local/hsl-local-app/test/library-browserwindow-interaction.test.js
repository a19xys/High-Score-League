const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_BROWSERWINDOW_TESTS === "1";

function sameRect(a, b) {
  return a.height === b.height && a.left === b.left && a.top === b.top && a.width === b.width;
}

test("BrowserWindow keeps the library stable through cancel and rejected locations, then accepts a real root", { skip: !enabled, timeout: 90_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "library-location-flow-diagnostic",
      HSL_LIBRARY_PACK_COUNT: "5",
      HSL_LIBRARY_QUIET: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  for (const stable of [result.canceled, ...result.rejected.map((entry) => entry.state)]) {
    assert.equal(stable.scrollerSame, true);
    assert.equal(stable.cardsSame, true);
    assert.equal(stable.imagesSame, true);
    assert.equal(stable.scrollTop, result.initial.scrollTop);
    assert.equal(stable.scrollHeight, result.initial.scrollHeight);
    assert.equal(stable.active, result.initial.active);
    assert.equal(stable.cardCount, 5);
  }
  assert.deepEqual(result.rejected.map((entry) => entry.dialog.classification), ["pack-root", "inside-pack"]);
  assert.ok(result.rejected.every((entry) => entry.dialog.initialFocus === "detect-library-location"));
  assert.equal(result.rejected[0].state.focusedAction, "choose-pack-directory");
  assert.equal(result.rejected[1].state.focusedAction, "choose-pack-directory");
  assert.deepEqual(result.unsupported.actions, ["detect-library-location", "choose-library-location"]);
  assert.match(result.unsupported.feedback, /No se ha podido detectar una Biblioteca válida/);
  assert.deepEqual(result.detectionCalls.map((value) => value.split("/").at(-1)), ["pack-root", "inside-pack", "unsupported-layout"]);
  assert.equal(result.accepted.cardCount, 4);
  assert.equal(result.accepted.cardsSame, false);
});

test("BrowserWindow validates JUGAR and library interaction states in light and dark themes", { skip: !enabled, timeout: 60_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "visual-interaction-polish-diagnostic",
      HSL_LIBRARY_PACK_COUNT: "5",
      HSL_LIBRARY_QUIET: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  assert.deepEqual(result.fullFillFamilies, ["play-button", "app-dialog__button--primary"]);
  assert.deepEqual(result.tintedFamilies, ["account-primary"]);
  for (const theme of result.results) {
    assert.equal(theme.normal.filter, "none");
    assert.equal(theme.hovered.filter, "none");
    assert.doesNotMatch(theme.normal.transitionProperty, /(^|,\s*)all($|,)/);
    assert.equal(sameRect(theme.normal.rect, theme.hovered.rect), true);
    assert.equal(sameRect(theme.normal.rect, theme.focused.rect), true);
    assert.notEqual(theme.hovered.borderColor, theme.normal.borderColor);
    assert.notEqual(theme.hovered.boxShadow, theme.normal.boxShadow);
    assert.notEqual(theme.hovered.backgroundImage, theme.normal.backgroundImage);
    assert.equal(theme.focused.focusVisible, true);
    assert.notEqual(theme.focused.outline, theme.normal.outline);
    assert.equal(sameRect(theme.normal.rect, theme.active.rect), true);
    assert.notEqual(theme.active.transform, theme.normal.transform);
    assert.equal(theme.dialogNormal.filter, "none");
    assert.equal(theme.dialogHover.filter, "none");
    assert.doesNotMatch(theme.dialogNormal.transitionProperty, /(^|,\s*)all($|,)/);
    assert.equal(sameRect(theme.dialogNormal.rect, theme.dialogHover.rect), true);
    assert.equal(sameRect(theme.dialogNormal.rect, theme.dialogFocused.rect), true);
    assert.equal(sameRect(theme.dialogNormal.rect, theme.dialogActive.rect), true);
    assert.notEqual(theme.dialogHover.backgroundImage, theme.dialogNormal.backgroundImage);
    assert.notEqual(theme.dialogHover.borderColor, theme.dialogNormal.borderColor);
    assert.notEqual(theme.dialogHover.boxShadow, theme.dialogNormal.boxShadow);
    assert.equal(theme.dialogFocused.focusVisible, true);
    assert.notEqual(theme.dialogFocused.outline, theme.dialogNormal.outline);
    assert.notEqual(theme.dialogActive.transform, theme.dialogNormal.transform);
    assert.equal(theme.dialogDisabledNormal.backgroundImage, theme.dialogDisabledHover.backgroundImage);
    assert.equal(theme.dialogDisabledNormal.borderColor, theme.dialogDisabledHover.borderColor);
    assert.equal(theme.dialogDisabledNormal.boxShadow, theme.dialogDisabledHover.boxShadow);
    assert.notEqual(theme.accountPrimary.backgroundColor, theme.dialogNormal.backgroundColor);
    assert.equal(sameRect(theme.secondaryNormal.rect, theme.secondaryHover.rect), true);
    assert.equal(theme.secondaryHover.backgroundImage, theme.secondaryNormal.backgroundImage);
    assert.notEqual(theme.secondaryHover.borderColor, theme.secondaryNormal.borderColor);
    for (const control of Object.values(theme.locationControls)) {
      assert.equal(sameRect(control.normal.rect, control.hover.rect), true);
      assert.notEqual(control.hover.borderColor, control.normal.borderColor);
    }
  }
  assert.equal(result.disabledNormal.backgroundImage, result.disabledHover.backgroundImage);
  assert.equal(result.disabledNormal.borderColor, result.disabledHover.borderColor);
  assert.equal(result.disabledNormal.boxShadow, result.disabledHover.boxShadow);
});

test("BrowserWindow characterizes the five-Covers clamp caused by a transient four-pack scan", { skip: !enabled, timeout: 120_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "passive-topology-clamp-diagnostic",
      HSL_LIBRARY_PACK_COUNT: "5",
      HSL_LIBRARY_QUIET: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  const compact = result.results.map((scenario) => ({
    actualTop: scenario.actualTop,
    columns: scenario.columns,
    finalTop: scenario.frames.at(-1).scrollTop,
    minCards: Math.min(...scenario.frames.map((frame) => frame.cards.length)),
    minHeight: Math.min(...scenario.frames.map((frame) => frame.scrollHeight)),
    requestedTop: scenario.requestedTop,
    rowPitch: scenario.rowPitch,
    stableHeight: scenario.frames[0].scrollHeight,
    stableMax: scenario.stableMax,
  }));
  process.stderr.write(`five-cover-clamp:${JSON.stringify(compact)}\n`);
  assert.deepEqual([...new Set(compact.map((entry) => entry.columns))], [2, 1]);
  for (const scenario of result.results) {
    assert.equal(scenario.publications[0].variant, "omit-last");
    assert.equal(scenario.publications[0].length, 4);
    assert.equal(scenario.publications[0].currentLibraryStructureKey, "ready");
    assert.equal(scenario.publications[0].renderPlanMode, "structural");
    assert.equal(scenario.publications[0].synchronization, null);
    assert.notEqual(
      scenario.publications[0].oldLibraryPacksTopologyKey,
      scenario.publications[0].newLibraryPacksTopologyKey,
    );
    assert.equal(scenario.publications.at(-1).length, 5);
    assert.equal(Math.min(...scenario.frames.map((frame) => frame.cards.length)), 4);
    assert.ok(Math.min(...scenario.frames.map((frame) => frame.scrollHeight)) < scenario.frames[0].scrollHeight);
    const transientMax = Math.max(0, scenario.stableMax - scenario.rowPitch);
    const finalTop = scenario.frames.at(-1).scrollTop;
    if (scenario.actualTop > transientMax) assert.ok(finalTop <= transientMax + 1);
    else assert.equal(finalTop, scenario.actualTop);
  }
});

test("BrowserWindow keeps five Covers stable across passive Connectivity and Membership publications", { skip: !enabled, timeout: 150_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "passive-topology-clamp-diagnostic",
      HSL_LIBRARY_PACK_COUNT: "5",
      HSL_LIBRARY_PASSIVE_STABLE: "1",
      HSL_LIBRARY_QUIET: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  assert.deepEqual([...new Set(result.results.map((scenario) => scenario.columns))], [2, 1]);
  assert.deepEqual([...new Set(result.results.map((scenario) => scenario.operation))].sort(), ["connectivity", "membership"]);
  for (const scenario of result.results) {
    assert.ok(scenario.actualTop >= 0);
    assert.ok(scenario.publications.length >= 2);
    assert.ok(scenario.publications.every((publication) => publication.length === 5));
    assert.ok(scenario.publications.every((publication) => publication.variant === "stable"));
    assert.ok(scenario.publications.every((publication) => publication.currentLibraryStructureKey === "ready"));
    assert.ok(scenario.publications.every((publication) => publication.renderPlanMode === "incremental"));
    assert.ok(scenario.publications.every((publication) => publication.synchronization?.ok === true));
    assert.ok(scenario.publications.every((publication) => (
      publication.oldLibraryPacksTopologyKey === publication.newLibraryPacksTopologyKey
    )));
    assert.ok(scenario.frames.every((frame) => frame.cards.length === 5));
    assert.ok(scenario.frames.every((frame) => frame.scrollHeight === scenario.frames[0].scrollHeight));
    assert.ok(scenario.frames.every((frame) => frame.scrollTop === scenario.actualTop));
    assert.ok(scenario.frames.every((frame) => frame.nodes?.scroller === true));
    assert.ok(scenario.frames.every((frame) => frame.nodes?.target === true));
    assert.ok(scenario.frames.every((frame) => frame.nodes?.neighbors === true));
    assert.ok(scenario.frames.every((frame) => frame.nodes?.images === true));
    assert.deepEqual(scenario.summary.identityTransitions, []);
    assert.deepEqual(scenario.summary.geometryTransitions, []);
  }
});

test("BrowserWindow recorre Connectivity con cinco packs obtenidos de launcher-service y protege el scroll más reciente", { skip: !enabled, timeout: 240_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "production-authority-scroll-diagnostic",
      HSL_LIBRARY_PACK_COUNT: "5",
      HSL_LIBRARY_PASSIVE_STABLE: "1",
      HSL_LIBRARY_QUIET: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 24 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.authority.statesStable, true);
  assert.equal(result.authority.instanceKeys.length, 5);
  assert.deepEqual(result.authority.sources, ["initial", "deployment-context", "membership-checking", "account-profile", "ranking", "week-final"]);
  for (const scenario of result.matrix.results) {
    assert.equal(scenario.frames.every((frame) => frame.scrollTop === scenario.actualTop), true, `${scenario.sidebarWidth}:${scenario.requestedTop}:${scenario.operation}`);
    assert.equal(scenario.frames.every((frame) => frame.scrollHeight === scenario.frames[0].scrollHeight), true);
    assert.equal(scenario.frames.every((frame) => !frame.nodes || Object.values(frame.nodes).every(Boolean)), true);
    assert.equal(scenario.publications.every((publication) => publication.authoritySource === "launcher-service/library-snapshot-authority"), true);
    assert.equal(scenario.publications.every((publication) => publication.length === 5), true);
    assert.equal(scenario.publications.every((publication) => publication.renderPlanMode === "incremental"), true);
  }
  assert.equal(result.userScroll.userTop, result.userScroll.targetTop);
  assert.equal(result.userScroll.finalTop, result.userScroll.userTop);
  const afterUserScroll = result.userScroll.frames.filter((frame) => frame.phase === "user-scroll-during-refresh");
  assert.ok(afterUserScroll.length > 0);
  assert.equal(afterUserScroll.every((frame) => frame.scrollTop === result.userScroll.userTop), true);
  assert.equal(result.userScroll.publications.every((publication) => publication.length === 5), true);
});

test("BrowserWindow distinguishes hidden Covers metadata from a real cover asset change", { skip: !enabled, timeout: 60_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "local-scan-variation-diagnostic",
      HSL_LIBRARY_PACK_COUNT: "5",
      HSL_LIBRARY_QUIET: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  const { results } = JSON.parse(stdout.trim());
  const metadata = results.find((result) => result.variant === "covers-metadata");
  const asset = results.find((result) => result.variant === "cover-asset");

  for (const result of results) {
    assert.ok(result.frames.every((frame) => frame.cards.length === 5));
    assert.ok(result.frames.every((frame) => frame.scrollTop === result.scrollTop));
    assert.ok(result.frames.every((frame) => frame.scrollHeight === result.scrollHeight));
  }
  assert.ok(metadata.frames.every((frame) => frame.nodes?.target && frame.nodes?.neighbors && frame.nodes?.images));
  assert.deepEqual(metadata.summary.identityTransitions, []);
  assert.ok(asset.frames.some((frame) => frame.nodes?.target === false || frame.nodes?.neighbors === false || frame.nodes?.images === false));
  assert.ok(asset.summary.identityTransitions.length > 0);
});

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

  assert.doesNotMatch(preloadSource, /REFRESH EXPANSION|let expanded/);
  assert.match(fixtureSource, /sendInputEvent\(\{ type: "mouseWheel"/);
  assert.match(fixtureSource, /sendInputEvent\(\{ type: "mouseDown"/);
  assert.match(fixtureSource, /sendInputEvent\(\{ type: "mouseUp"/);

  for (const selection of result.selections) {
    const samples = Object.fromEntries(selection.trace.map((sample) => [sample.label, sample]));
    const before = samples["A-stable"];
    assert.ok(selection.initialScrollTop > 0, `${selection.view} debe partir desplazada`);
    assert.equal(selection.flicker, false, JSON.stringify({
      geometryTransitions: selection.geometryTransitions,
      identityTransitions: selection.identityTransitions,
      view: selection.view,
    }));
    assert.equal(selection.maxScrollDelta, 0, selection.view);
    assert.deepEqual(selection.geometryTransitions, [], `${selection.view} no debe alterar geometrí­a`);
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
    assert.equal(theme.badges.ACTIVA.color, theme.semanticColors.success);
    assert.equal(theme.badges.INACTIVA.color, theme.semanticColors.warning);
    assert.equal(theme.badges.CERRADA.color, theme.semanticColors.warning);
    assert.equal(theme.badges["SIN VINCULAR"].color, theme.semanticColors.warning);
    assert.equal(theme.badges["SIN DATOS"].color, theme.semanticColors.textMuted);
    assert.equal(theme.badges["REQUIERE ATENCION"].color, theme.semanticColors.error);
    assert.notEqual(theme.badges.ACTIVA.background, theme.badges.INACTIVA.background);
    assert.notEqual(theme.badges.INACTIVA.background, theme.badges["REQUIERE ATENCION"].background);
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
    assert.equal(offset.modalOverflow, "hidden");
    assert.notEqual(offset.drawerShadow, "none");
    assert.equal(offset.buttonHeight, 38);
    assert.equal(offset.buttonWidth, 38);
    assert.equal(offset.iconHeight, 18);
    assert.equal(offset.iconWidth, 18);
    assert.equal(offset.glyphTransform, "matrix(1, 0, 0, 1, 0, 0)");
  });
  assert.deepEqual(result.heroAndDrawers.closeButtons.map(({ drawer }) => drawer), ["settings", "activity"]);
  assert.equal(result.heroAndDrawers.titlebar.settingsUnchanged, true);
  assert.equal(result.heroAndDrawers.titlebar.activityUnchanged, true);
  assert.equal(result.heroAndDrawers.titlebar.betweenUnchanged, true);
  assert.ok(result.heroAndDrawers.titlebar.byteLength > 0);
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
    assert.ok(Math.abs(indicator.width - 38) <= 1);
    assert.ok(indicator.labelWidth <= 1);
  });

  assert.deepEqual(result.accounts.requiresLogin, {
    busyOverlaySeen: false,
    calls: 0,
    controlsDisabled: false,
    email: "relogin@example.test",
    formVisible: true,
    menuOpen: true,
    message: "Inicia sesión de nuevo para esta cuenta.",
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

test("BrowserWindow autocorrige autoridad competitiva antes de JUGAR", { skip: !enabled, timeout: 120_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "authority",
      HSL_LIBRARY_QUIET: "1",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.actions.beforeClosedPreflight.badge, "ACTIVA");
  assert.equal(result.actions.beforeClosedPreflight.competitionDisabled, false);
  assert.equal(result.actions.afterClosedPreflight.badge, "CERRADA");
  assert.equal(result.actions.afterClosedPreflight.competitionDisabled, true);
  assert.equal(result.actions.afterClosedPreflight.practiceDisabled, false);
  assert.equal(result.actions.afterTemporaryFailure.badge, "ACTIVA");
  assert.equal(result.actions.afterTemporaryFailure.asksForLogin, false);
  assert.deepEqual(result.actions.actionCounts, { competitionLaunches: 0, practiceLaunches: 1 });
});

test("BrowserWindow preserves cards and scroll during passive connectivity refresh", { skip: !enabled, timeout: 240_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "render-invariants-before",
      HSL_LIBRARY_QUIET: "1",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());
  assert.deepEqual(result.scenarios.map(({ direct, expanded, expectedStatuses, nearBottom, view }) => ({ direct, expanded, expectedStatuses, nearBottom, view })), [
    { direct: false, expanded: false, expectedStatuses: ["CERRADA"], nearBottom: false, view: "covers" },
    { direct: false, expanded: false, expectedStatuses: ["CERRADA"], nearBottom: true, view: "covers" },
    { direct: false, expanded: false, expectedStatuses: ["CERRADA"], nearBottom: false, view: "list" },
    { direct: false, expanded: false, expectedStatuses: ["CERRADA"], nearBottom: false, view: "icons" },
    { direct: false, expanded: false, expectedStatuses: ["CERRADA", "ACTIVA", "INACTIVA"], nearBottom: false, view: "covers" },
    { direct: false, expanded: true, expectedStatuses: ["CERRADA"], nearBottom: false, view: "covers" },
    { direct: true, expanded: false, expectedStatuses: ["CERRADA"], nearBottom: false, view: "covers" },
  ]);
  for (const scenario of result.scenarios) {
    const label = `${scenario.view}:${scenario.nearBottom ? "bottom" : "middle"}:${scenario.direct ? "direct" : "manual"}`;
    assert.equal(scenario.beforeStatus, "ACTIVA", label);
    assert.equal(scenario.afterStatus, scenario.expectedStatuses.at(-1), label);
    assert.deepEqual(scenario.observedStatuses, scenario.expectedStatuses, label);
    assert.equal(scenario.allCardsSame, true, label);
    assert.equal(scenario.allImagesSame, true, label);
    assert.equal(scenario.scrollerSame, true, label);
    assert.equal(scenario.initialScrollHeight, scenario.finalScrollHeight, label);
    assert.equal(scenario.initialScrollTop, scenario.finalScrollTop, label);
    assert.ok(scenario.initialScrollTop > 0, label);
    assert.equal(scenario.maxScrollDelta, 0, label);
    assert.equal(scenario.frameTrace.at(-1).scrollEvents, 0, label);
    assert.deepEqual(scenario.geometryTransitions, [], label);
    assert.deepEqual(scenario.identityTransitions, [], label);
    assert.equal(new Set(scenario.frameTrace.map((frame) => frame.scrollHeight)).size, 1, label);
    scenario.frameTrace.forEach((frame) => assert.equal(frame.scrollTop, scenario.initialScrollTop, `${label}:frame-${frame.frame}`));
    assert.deepEqual(scenario.imageStatesAfter, scenario.imageStates, label);
    scenario.imageStates.forEach((image, index) => {
      if (image.status === "loaded") {
        assert.equal(scenario.imageStatesAfter[index].status, "loaded", label);
        assert.equal(scenario.imageStatesAfter[index].hidden, false, label);
      }
    });
    assert.equal(
      scenario.finalRefreshCount - scenario.initialRefreshCount,
      scenario.direct ? 0 : scenario.expectedStatuses.length,
      label,
    );
    assert.equal(scenario.focusAfter, scenario.direct ? scenario.focusBefore : "refresh-connectivity", label);
    if (scenario.expanded) {
      assert.deepEqual(scenario.publications, [
        "connectivity-start",
        "deployment-context",
        "membership-checking",
        "profile-and-membership",
        "ranking-capabilities",
        "connectivity-settled",
        "week-final",
      ], label);
    }
  }
});

test("BrowserWindow keeps JUGAR disabled through accepted pack revalidation", { skip: !enabled, timeout: 60_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "activation-stability-diagnostic",
      HSL_LIBRARY_QUIET: "1",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const trace = JSON.parse(stdout.trim());
  assert.deepEqual(trace.map(({ playDisabled }) => playDisabled), [false, true, true, true, false]);
  assert.deepEqual(trace.map(({ playTitle }) => playTitle), [
    "Jugar",
    "Activando pack",
    "Comprobando pack",
    "Comprobando participación",
    "Jugar",
  ]);
  assert.deepEqual(trace.map(({ overlay }) => overlay), [
    null,
    "Activando pack...",
    "Comprobando pack...",
    null,
    null,
  ]);
});
