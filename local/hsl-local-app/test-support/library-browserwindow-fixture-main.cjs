const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, nativeImage } = require("electron");

const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hsl-library-browserwindow-"));
app.setPath("userData", profileDirectory);
app.commandLine.appendSwitch("disk-cache-dir", path.join(profileDirectory, "cache"));
if (process.env.HSL_LIBRARY_USE_GPU !== "1") app.commandLine.appendSwitch("disable-gpu");

const rendererDocument = path.join(__dirname, "..", "gui", "renderer", "index.html");
const screenshotDirectory = process.env.HSL_LIBRARY_SMOKE_DIR || null;
const traceVisible = process.env.HSL_LIBRARY_TRACE_VISIBLE === "1";
const traceOnly = process.env.HSL_LIBRARY_TRACE_ONLY === "1";
const resizeOnly = process.env.HSL_LIBRARY_RESIZE_ONLY === "1";
const checkOnly = process.env.HSL_LIBRARY_CHECK_ONLY || "";
const quietOutput = process.env.HSL_LIBRARY_QUIET === "1";
const TRANSPARENT_TITLE_BAR_OVERLAY = "#00000000";
let alphaFixtureDirectory = null;

function titleBarOverlay(theme) {
  return {
    color: TRANSPARENT_TITLE_BAR_OVERLAY,
    height: 32,
    symbolColor: theme === "light" ? "#0f172a" : "#f8fafc",
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prepareAlphaFixtureAssets() {
  const size = 64;
  alphaFixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hsl-library-alpha-"));
  const definitions = {
    corners: (x, y) => {
      const inset = Math.min(x + y, size - 1 - x + y, x + size - 1 - y, size - 1 - x + size - 1 - y);
      return { alpha: inset < 14 ? 0 : 255, blue: 52, green: 156, red: 235 };
    },
    "full-bleed": (x, y) => ({
      alpha: 255,
      blue: Math.round(42 + (x / (size - 1)) * 92),
      green: Math.round(70 + (y / (size - 1)) * 84),
      red: 24,
    }),
    "internal-hole": (x, y) => ({
      alpha: x >= 22 && x < 42 && y >= 22 && y < 42 ? 0 : 255,
      blue: 92,
      green: 180,
      red: 42,
    }),
    sprite: (x, y) => ({
      alpha: x >= 14 && x < 50 && y >= 14 && y < 50 ? 255 : 0,
      blue: 225,
      green: 112,
      red: 31,
    }),
  };
  const urls = {};

  for (const [name, pixelAt] of Object.entries(definitions)) {
    const bitmap = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * 4;
        const pixel = pixelAt(x, y);
        bitmap[offset] = pixel.blue;
        bitmap[offset + 1] = pixel.green;
        bitmap[offset + 2] = pixel.red;
        bitmap[offset + 3] = pixel.alpha;
      }
    }
    const outputPath = path.join(alphaFixtureDirectory, `${name}.png`);
    fs.writeFileSync(outputPath, nativeImage.createFromBitmap(bitmap, { height: size, width: size }).toPNG());
    urls[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = pathToFileURL(outputPath).href;
  }

  process.env.HSL_LIBRARY_ALPHA_ASSETS = JSON.stringify(urls);
}

async function waitFor(window, expression, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function stage(name, operation) {
  let timeout = null;
  try {
    if (process.env.HSL_LIBRARY_STAGE_LOG === "1") process.stderr.write(`stage:${name}:start\n`);
    const result = await Promise.race([
      operation(),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("fixture stage timed out")), 20_000);
      }),
    ]);
    if (process.env.HSL_LIBRARY_STAGE_LOG === "1") process.stderr.write(`stage:${name}:done\n`);
    return result;
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error });
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

async function waitForFrames(window, count = 2) {
  await window.webContents.executeJavaScript(`new Promise((resolve) => {
    let remaining = ${count};
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
}

async function sample(window, label) {
  return window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    const refs = window.__hslSelectionRefs;
    const target = refs
      ? [...scroller.querySelectorAll('.pack-card')].find((card) => card.dataset.instanceKey === refs.targetInstanceKey)
      : null;
    const active = document.activeElement;
    return {
      label: ${JSON.stringify(label)},
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      identity: scroller.dataset.fixtureIdentity,
      selected: document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey || null,
      pending: document.querySelector('.pack-card--pending')?.dataset.instanceKey || null,
      detailScrollTop: document.querySelector('.game-scroll').scrollTop,
      phase: window.hslFixture.getSelectionPhase(),
      scrollEvents: window.__hslSelectionScrollEvents || 0,
      focusedTag: active?.tagName || null,
      focusedInstanceKey: active?.closest?.('.pack-card')?.dataset.instanceKey || null,
      nodes: refs ? {
        scroller: refs.scroller === scroller,
        target: refs.target === target,
        neighbors: refs.neighbors.every((card) => card.isConnected && card === [...scroller.querySelectorAll('.pack-card')].find((candidate) => candidate.dataset.instanceKey === card.dataset.instanceKey)),
        images: refs.images.every((image) => image.isConnected && image === [...scroller.querySelectorAll('.pack-card__art')].find((candidate) => candidate.dataset.assetSelection === image.dataset.assetSelection)),
      } : null,
    };
  })()`);
}

async function beginFrameTrace(window) {
  await window.webContents.executeJavaScript(`(() => {
    const measure = () => {
      const scroller = document.querySelector('[data-render-region="library-packs"]');
      const scrollerRect = scroller.getBoundingClientRect();
      const refs = window.__hslSelectionRefs;
      const cards = [...scroller.querySelectorAll('.pack-card')].map((card) => {
        const cardRect = card.getBoundingClientRect();
        const mediaRect = card.querySelector('.pack-card__media')?.getBoundingClientRect();
        const bodyRect = card.querySelector('.pack-card__body')?.getBoundingClientRect();
        const titleRect = card.querySelector('.pack-card__text h3')?.getBoundingClientRect();
        return {
          instanceKey: card.dataset.instanceKey,
          top: cardRect.top - scrollerRect.top + scroller.scrollTop,
          height: cardRect.height,
          bottom: cardRect.bottom - scrollerRect.top + scroller.scrollTop,
          mediaHeight: mediaRect?.height || 0,
          bodyHeight: bodyRect?.height || 0,
          titleHeight: titleRect?.height || 0,
          selected: card.dataset.selected === 'true',
          pending: card.classList.contains('pack-card--pending'),
        };
      });
      const rowTops = [...new Set(cards.map((card) => Math.round(card.top * 100) / 100))];
      const visibleCards = cards.filter((card) => {
        const viewportTop = scroller.scrollTop;
        const viewportBottom = viewportTop + scroller.clientHeight;
        return card.bottom >= viewportTop && card.top <= viewportBottom;
      });
      const active = document.activeElement;
      const target = refs
        ? [...scroller.querySelectorAll('.pack-card')].find((card) => card.dataset.instanceKey === refs.targetInstanceKey)
        : null;
      const content = scroller.firstElementChild;
      return {
        frame: window.__hslFrameTrace?.length || 0,
        phase: window.__hslTracePhase || 'A-stable',
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
        identity: scroller.dataset.fixtureIdentity,
        view: document.querySelector('[data-action="set-library-view"].view-button--active')?.dataset.view || null,
        selected: document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey || null,
        pending: document.querySelector('.pack-card--pending')?.dataset.instanceKey || null,
        focusedTag: active?.tagName || null,
        focusedInstanceKey: active?.closest?.('.pack-card')?.dataset.instanceKey || null,
        contentHeight: content?.getBoundingClientRect().height || 0,
        scrollEvents: window.__hslSelectionScrollEvents || 0,
        nodes: refs ? {
          scroller: refs.scroller === scroller,
          target: refs.target === target,
          neighbors: refs.neighbors.every((card) => card.isConnected && card === [...scroller.querySelectorAll('.pack-card')].find((candidate) => candidate.dataset.instanceKey === card.dataset.instanceKey)),
          images: refs.images.every((image) => image.isConnected && image === [...scroller.querySelectorAll('.pack-card__art')].find((candidate) => candidate.dataset.assetSelection === image.dataset.assetSelection)),
        } : null,
        cards,
        visibleCards,
        rowTops,
      };
    };
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    window.__hslSelectionScrollEvents = 0;
    window.__hslSelectionScrollHandler = () => { window.__hslSelectionScrollEvents += 1; };
    scroller.addEventListener('scroll', window.__hslSelectionScrollHandler);
    window.__hslFrameTrace = [measure()];
    window.__hslFrameTraceActive = true;
    const tick = () => {
      if (!window.__hslFrameTraceActive) return;
      window.__hslFrameTrace.push(measure());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
}

async function endFrameTrace(window) {
  return window.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__hslFrameTraceActive = false;
      const scroller = document.querySelector('[data-render-region="library-packs"]');
      scroller.removeEventListener('scroll', window.__hslSelectionScrollHandler);
      resolve(window.__hslFrameTrace);
    })));
  })`);
}

function summarizeFrameTrace(frames) {
  const geometryTransitions = [];
  const identityTransitions = [];
  const initialScrollTop = frames[0]?.scrollTop || 0;

  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1];
    const after = frames[index];
    if (before.scrollHeight === after.scrollHeight && before.scrollTop === after.scrollTop) continue;
    const beforeCards = new Map(before.cards.map((card) => [card.instanceKey, card]));
    const changedCards = after.cards.flatMap((card) => {
      const previous = beforeCards.get(card.instanceKey);
      if (!previous) return [];
      const changed = ["height", "mediaHeight", "bodyHeight", "titleHeight"]
        .some((key) => previous[key] !== card[key]);
      return changed ? [{
        instanceKey: card.instanceKey,
        before: Object.fromEntries(["height", "mediaHeight", "bodyHeight", "titleHeight"].map((key) => [key, previous[key]])),
        after: Object.fromEntries(["height", "mediaHeight", "bodyHeight", "titleHeight"].map((key) => [key, card[key]])),
      }] : [];
    });
    geometryTransitions.push({
      frame: after.frame,
      before: { scrollHeight: before.scrollHeight, scrollTop: before.scrollTop, maxScrollTop: before.maxScrollTop },
      after: { scrollHeight: after.scrollHeight, scrollTop: after.scrollTop, maxScrollTop: after.maxScrollTop },
      changedCards,
      pending: after.pending,
      selected: after.selected,
    });
  }

  frames.forEach((frame) => {
    if (frame.nodes && Object.values(frame.nodes).some((same) => !same)) {
      identityTransitions.push({ frame: frame.frame, nodes: frame.nodes, phase: frame.phase });
    }
  });

  return {
    flicker: geometryTransitions.length > 0 || identityTransitions.length > 0,
    frameTrace: frames.map(({ cards, rowTops, visibleCards, ...frame }) => frame),
    geometryTransitions,
    identityTransitions,
    maxScrollDelta: Math.max(...frames.map((frame) => Math.abs(frame.scrollTop - initialScrollTop))),
  };
}

async function scrollLibraryWithWheel(window, { nearBottom, requestedTop }) {
  const coordinates = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-render-region="library-packs"]').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: "mouseMove", ...coordinates });
  const attempts = [];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const metrics = await window.webContents.executeJavaScript(`(() => {
      const scroller = document.querySelector('[data-render-region="library-packs"]');
      return { max: scroller.scrollHeight - scroller.clientHeight, top: scroller.scrollTop };
    })()`);
    const desired = nearBottom ? metrics.max : Math.min(requestedTop, Math.max(0, metrics.max - 80));
    const tolerance = nearBottom ? 2 : Math.max(80, desired * 0.5);
    if (Math.abs(desired - metrics.top) <= tolerance && metrics.top > 0) return { ...metrics, desired };
    const delta = Math.min(nearBottom ? 1_200 : 600, Math.max(120, Math.abs(desired - metrics.top)));
    const direction = desired > metrics.top ? -1 : 1;
    attempts.push({ deltaY: direction * delta, desired, top: metrics.top });
    window.webContents.sendInputEvent({ type: "mouseWheel", ...coordinates, deltaY: direction * delta });
    await waitForLibraryScrollToSettle(window);
  }

  throw new Error(`Wheel input did not reach the requested library position: ${JSON.stringify(attempts)}`);
}

async function waitForLibraryScrollToSettle(window) {
  let previous = null;
  let stableFrames = 0;

  for (let frame = 0; frame < 90; frame += 1) {
    await waitForFrames(window, 1);
    const top = await window.webContents.executeJavaScript(
      "document.querySelector('[data-render-region=\"library-packs\"]').scrollTop",
    );
    stableFrames = top === previous ? stableFrames + 1 : 0;
    if (stableFrames >= 3) return top;
    previous = top;
  }

  throw new Error("Library wheel input did not settle before selection");
}

async function selectVisiblePack(window, { nearBottom = false, requestedTop = 600, view = "covers" } = {}) {
  await window.webContents.executeJavaScript(`document.querySelector('[data-action="set-library-view"][data-view="${view}"]')?.click()`);
  await waitForFrames(window, 2);
  const scroll = await scrollLibraryWithWheel(window, { nearBottom, requestedTop });
  await waitForLibraryScrollToSettle(window);
  const setup = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    scroller.dataset.fixtureIdentity ||= 'library-packs-node';
    const bounds = scroller.getBoundingClientRect();
    const selectableCards = [...scroller.querySelectorAll('[data-action="use-library-pack"]')];
    const candidates = selectableCards
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.top >= bounds.top + 12 && rect.bottom <= bounds.bottom - 12;
      });
    const visibleCards = selectableCards.filter((card) => {
      const rect = card.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      return center >= bounds.top + 12 && center <= bounds.bottom - 12;
    });
    const targetPool = candidates.length > 0 ? candidates : visibleCards;
    const target = targetPool[Math.floor(targetPool.length / 2)];
    if (!target) throw new Error('No selectable card is visible after wheel input');
    const cards = [...scroller.querySelectorAll('.pack-card')];
    const targetIndex = cards.indexOf(target);
    const neighbors = cards.filter((_, index) => Math.abs(index - targetIndex) <= 2 && index !== targetIndex);
    const images = [target, ...neighbors].map((card) => card.querySelector('.pack-card__art')).filter(Boolean);
    const rect = target.getBoundingClientRect();
    window.__hslSelectionRefs = {
      images,
      neighbors,
      scroller,
      target,
      targetInstanceKey: target.dataset.instanceKey,
    };
    window.__hslTracePhase = 'A-stable';
    return {
      instanceKey: target.dataset.instanceKey,
      scrollTop: scroller.scrollTop,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`);
  await window.webContents.executeJavaScript("document.querySelector('.game-scroll').scrollTop = 160");
  const trace = [await sample(window, "A-stable")];
  await beginFrameTrace(window);
  await window.webContents.executeJavaScript("window.__hslTracePhase = 'B-mousedown-focus'");
  window.webContents.sendInputEvent({ type: "mouseMove", x: setup.x, y: setup.y });
  window.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, x: setup.x, y: setup.y });
  await waitForFrames(window, 1);
  trace.push(await sample(window, "B-mousedown-focus"));
  await window.webContents.executeJavaScript("window.__hslTracePhase = 'C-mouseup-click'");
  window.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, x: setup.x, y: setup.y });
  trace.push(await sample(window, "C-mouseup-click"));
  await waitFor(window, "document.querySelector('.pack-card--pending')");
  await window.webContents.executeJavaScript("window.__hslTracePhase = 'D-pending'");
  trace.push(await sample(window, "D-pending"));
  await waitFor(window, `document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey === ${JSON.stringify(setup.instanceKey)} && !document.querySelector('.pack-card--pending')`);
  await window.webContents.executeJavaScript("window.__hslTracePhase = 'E-accepted'");
  trace.push(await sample(window, "E-accepted"));
  await waitFor(window, "window.hslFixture.getSelectionPhase() === 'refresh'");
  await window.webContents.executeJavaScript("window.__hslTracePhase = 'F-refresh'");
  trace.push(await sample(window, "F-refresh"));
  await waitForFrames(window, 1);
  trace.push(await sample(window, "G-one-frame"));
  await waitForFrames(window, 2);
  trace.push(await sample(window, "G-three-frames"));
  const frameDiagnostics = summarizeFrameTrace(await endFrameTrace(window));
  return {
    ...frameDiagnostics,
    initialScrollTop: setup.scrollTop,
    nearBottom,
    scrollInput: scroll,
    targetInstanceKey: setup.instanceKey,
    trace,
    view,
  };
}

async function visualMetrics(window) {
  return window.webContents.executeJavaScript(`(() => {
    const value = (element, property) => getComputedStyle(element)[property];
    const active = document.querySelector('.pack-card[data-selected="true"]');
    const activeFavorite = active.querySelector('.favorite-icon.ui-icon');
    const otherFavorite = [...document.querySelectorAll('.pack-card:not([data-selected="true"]) .favorite-slot--active .favorite-icon.ui-icon')][0];
    const badgeMap = Object.fromEntries([...document.querySelectorAll('.week-status-badge')].map((badge) => [badge.textContent.trim(), {
      background: value(badge, 'backgroundColor'),
      border: value(badge, 'borderColor'),
      color: value(badge, 'color'),
    }]));
    const activeBadge = active.querySelector('.week-status-badge');
    const matchingBadge = [...document.querySelectorAll('.pack-card:not([data-selected="true"]) .week-status-badge')]
      .find((badge) => badge.textContent === activeBadge.textContent);
    const semanticColor = (token) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(' + token + ')';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      active: {
        ariaCurrent: active.getAttribute('aria-current'),
        ariaDisabled: active.getAttribute('aria-disabled'),
        role: active.getAttribute('role'),
        selectable: active.hasAttribute('data-action'),
        favoriteDisabled: active.querySelector('.favorite-slot').disabled,
      },
      favorite: {
        active: { color: value(activeFavorite, 'color'), filter: value(activeFavorite, 'filter'), opacity: value(activeFavorite, 'opacity') },
        other: { color: value(otherFavorite, 'color'), filter: value(otherFavorite, 'filter'), opacity: value(otherFavorite, 'opacity') },
      },
      badges: badgeMap,
      selectedBadge: {
        active: { background: value(activeBadge, 'backgroundColor'), border: value(activeBadge, 'borderColor'), color: value(activeBadge, 'color') },
        other: { background: value(matchingBadge, 'backgroundColor'), border: value(matchingBadge, 'borderColor'), color: value(matchingBadge, 'color') },
      },
      semanticColors: {
        circuit: semanticColor('--circuit'),
        error: semanticColor('--state-error'),
        success: semanticColor('--state-success'),
        textInverse: semanticColor('--text-inverse'),
        warning: semanticColor('--state-warning'),
      },
    };
  })()`);
}

async function signalMetrics(window) {
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"set-library-view\"][data-view=\"icons\"]')?.click()");
  await delay(30);
  return window.webContents.executeJavaScript(`(() => {
    const connection = document.querySelector('.connection-dot');
    const pack = document.querySelector('.pack-card__status-dot');
    const read = (element) => {
      const style = getComputedStyle(element);
      return {
        width: style.width,
        height: style.height,
        background: style.backgroundColor,
        border: style.borderWidth + ' ' + style.borderStyle + ' ' + style.borderColor,
        color: style.color,
        radius: style.borderRadius,
        childCount: element.childElementCount,
        shadow: style.boxShadow,
        pseudoAfter: getComputedStyle(element, '::after').content,
      };
    };
    return { connection: read(connection), pack: read(pack) };
  })()`);
}

async function iconRows(window) {
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"set-library-view\"][data-view=\"icons\"]')?.click()");
  await waitForFrames(window);
  const rows = [];
  for (const width of [340, 440, 600]) {
    rows.push(await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '${width}px');
      const grid = document.querySelector('.library-pack-grid--icons');
      const cards = [...grid.querySelectorAll('.pack-card')];
      const firstTop = cards[0].getBoundingClientRect().top;
      const firstRow = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) <= 1);
      const read = (card) => {
        const rect = (selector) => card.querySelector(selector).getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const bodyRect = rect('.pack-card__body');
        const textRect = rect('.pack-card__text');
        const titleRect = rect('.pack-card__text h3');
        const textStyle = getComputedStyle(card.querySelector('.pack-card__text'));
        return {
          bodyCenter: bodyRect.top + bodyRect.height / 2,
          bodyHeight: bodyRect.height,
          cardHeight: cardRect.height,
          lines: Math.round(titleRect.height / parseFloat(getComputedStyle(card.querySelector('h3')).lineHeight)),
          title: card.querySelector('h3').textContent.trim(),
          titleCenter: titleRect.top + titleRect.height / 2,
          titleHeight: titleRect.height,
          textCenter: textRect.top + textRect.height / 2,
          textDisplay: textStyle.display,
          textHeight: textRect.height,
          textJustifyContent: textStyle.justifyContent,
        };
      };
      const rows = new Map();
      for (const card of cards) {
        const top = Math.round(card.getBoundingClientRect().top);
        if (!rows.has(top)) rows.set(top, []);
        rows.get(top).push(read(card));
      }
      const mixedRow = [...rows.values()].find((row) => (
        row.some((card) => card.lines === 1) && row.some((card) => card.lines === 2)
      )) || firstRow.map(read);
      return { width: ${width}, columns: firstRow.length, cards: mixedRow };
    })()`));
  }
  return rows;
}

async function iconAlphaMetrics(window) {
  return window.webContents.executeJavaScript(`Promise.all(
    ${JSON.stringify(["star-filled", "star-empty", "check", "error", "close", "refresh"])}.map((name) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let left = size;
        let right = -1;
        let top = size;
        let bottom = -1;
        let alphaTotal = 0;
        let weightedX = 0;
        let weightedY = 0;
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const alpha = pixels[(y * size + x) * 4 + 3];
            if (alpha === 0) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            alphaTotal += alpha;
            weightedX += x * alpha;
            weightedY += y * alpha;
          }
        }
        const canvasCenter = (size - 1) / 2;
        const centerX = weightedX / alphaTotal;
        const centerY = weightedY / alphaTotal;
        const project = (contextSize) => ({
          x: (centerX - canvasCenter) * contextSize / size,
          y: (centerY - canvasCenter) * contextSize / size,
        });
        resolve([name, {
          alphaBounds: { bottom, left, right, top },
          alphaCenter: { x: centerX, y: centerY },
          canvas: { height: size, width: size },
          offset: { x: centerX - canvasCenter, y: centerY - canvasCenter },
          projected16: project(16),
          projected40: project(40),
        }]);
      };
      image.onerror = () => reject(new Error('No se pudo cargar ' + name));
      image.src = new URL('./assets/icons/' + name + '.svg', location.href).href;
    }))
  ).then((entries) => Object.fromEntries(entries))`);
}

async function capture(window, filename) {
  if (!screenshotDirectory) return;
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(screenshotDirectory, filename), image.toPNG());
}

async function captureNativeWindow(window, filename) {
  if (!screenshotDirectory) return;
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  window.show();
  window.focus();
  await delay(40);
  const handle = window.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const outputPath = path.join(screenshotDirectory, filename).replaceAll("'", "''");
  const script = `
    Add-Type -AssemblyName System.Drawing;
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HslNativeCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
'@;
    $rect = New-Object HslNativeCapture+RECT;
    [HslNativeCapture]::GetWindowRect([IntPtr]${handle}, [ref]$rect) | Out-Null;
    $size = New-Object System.Drawing.Size(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top));
    $bitmap = New-Object System.Drawing.Bitmap($size.Width, $size.Height);
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap);
    try {
      $hdc = $graphics.GetHdc();
      try {
        if (-not [HslNativeCapture]::PrintWindow([IntPtr]${handle}, $hdc, 2)) {
          throw 'PrintWindow failed';
        }
      } finally {
        $graphics.ReleaseHdc($hdc);
      }
      $bitmap.Save('${outputPath}', [System.Drawing.Imaging.ImageFormat]::Png);
    } finally {
      $graphics.Dispose();
      $bitmap.Dispose();
    }
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
}

function moveSystemCursorOverWindow(window, relativeX, relativeY, click = false) {
  if (process.platform !== "win32") return;
  const handle = window.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const bounds = window.getBounds();
  const script = `
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HslNativeCursor {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@;
    $rect = New-Object HslNativeCursor+RECT;
    [HslNativeCursor]::GetWindowRect([IntPtr]${handle}, [ref]$rect) | Out-Null;
    $scaleX = ($rect.Right - $rect.Left) / ${bounds.width};
    $scaleY = ($rect.Bottom - $rect.Top) / ${bounds.height};
    [HslNativeCursor]::SetCursorPos(
      [Math]::Round($rect.Left + ${relativeX} * $scaleX),
      [Math]::Round($rect.Top + ${relativeY} * $scaleY)
    ) | Out-Null;
    ${click ? "[HslNativeCursor]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 35; [HslNativeCursor]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero);" : ""}
  `;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
}

async function filterScrollMetrics(window) {
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"set-library-view\"][data-view=\"covers\"]')?.click()");
  await waitForFrames(window);
  const run = async (label, expression) => {
    const before = await window.webContents.executeJavaScript(`(() => {
      const scroller = document.querySelector('[data-render-region="library-packs"]');
      scroller.scrollTop = Math.min(180, Math.max(0, scroller.scrollHeight - scroller.clientHeight - 10));
      return scroller.scrollTop;
    })()`);
    await window.webContents.executeJavaScript(expression);
    await waitForFrames(window);
    const after = await window.webContents.executeJavaScript("document.querySelector('[data-render-region=\"library-packs\"]').scrollTop");
    return { after, before, label };
  };

  const presentation = [];
  presentation.push(await run("open-filters", "document.querySelector('[data-action=\\\"toggle-library-filters\\\"]')?.click()"));
  const results = [];
  results.push(await run("sort-by", `(() => {
    const select = document.querySelector('[data-library-sort-by]');
    select.value = 'title';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`));
  results.push(await run("direction", "document.querySelector('[data-action=\\\"toggle-library-sort-direction\\\"]')?.click()"));
  results.push(await run("favorites-on", "document.querySelector('[data-action=\\\"toggle-library-favorite-filter\\\"]')?.click()"));
  results.push(await run("favorites-off", "document.querySelector('[data-action=\\\"toggle-library-favorite-filter\\\"]')?.click()"));
  results.push(await run("season", `(() => {
    const select = document.querySelector('[data-library-season]');
    select.value = 'season-1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`));
  results.push(await run("search", `(() => {
    const input = document.querySelector('[data-library-search]');
    input.value = 'PAC MAN';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`));
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-library-search]');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const season = document.querySelector('[data-library-season]');
    season.value = 'all';
    season.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitForFrames(window);
  presentation.push(await run("close-filters", "document.querySelector('[data-action=\\\"toggle-library-filters\\\"]')?.click()"));
  return { presentation, results };
}

async function hostileSignalMetrics(window) {
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"set-library-view\"][data-view=\"icons\"]')?.click()");
  await waitForFrames(window);
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('#fixture-hostile-signals')?.remove();
    const source = document.querySelector('.pack-card__status-dot');
    const host = document.createElement('section');
    host.id = 'fixture-hostile-signals';
    host.setAttribute('aria-label', 'Contraste de seÃ±ales');
    Object.assign(host.style, {
      background: 'var(--surface)', display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(5, 72px)',
      left: '24px', padding: '16px', position: 'fixed', top: '96px', zIndex: '9999'
    });
    const cases = [
      ['success', '#22e36f'], ['warning', '#ffc62e'], ['error', '#ff4d5f'], ['neutral', '#ffffff'], ['info', '#000000']
    ];
    for (const [tone, background] of cases) {
      const tile = document.createElement('div');
      tile.dataset.tone = tone;
      Object.assign(tile.style, { alignItems: 'center', background, display: 'grid', height: '56px', justifyItems: 'center' });
      const beacon = source.cloneNode(true);
      beacon.className = 'status-beacon status-beacon--' + tone + ' status-beacon--pack';
      tile.append(beacon);
      host.append(tile);
    }
    document.body.append(host);
  })()`);
  const themes = {};
  for (const theme of ["dark", "light"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await waitForFrames(window);
    themes[theme] = await window.webContents.executeJavaScript(`(() => Object.fromEntries(
      [...document.querySelectorAll('#fixture-hostile-signals [data-tone]')].map((tile) => {
        const beacon = tile.querySelector('.status-beacon');
        return [tile.dataset.tone, {
          backdrop: getComputedStyle(tile).backgroundColor,
          border: getComputedStyle(beacon).borderColor,
          childCount: beacon.childElementCount,
          fill: getComputedStyle(beacon).backgroundColor,
        }];
      })
    ))()`);
    await capture(window, `signals-hostile-${theme}.png`);
  }
  await window.webContents.executeJavaScript("document.querySelector('#fixture-hostile-signals')?.remove()");
  return themes;
}

async function accountMetrics(window) {
  const observeSwitch = async (userId) => {
    await window.webContents.executeJavaScript(`(() => {
      if (!document.querySelector('[data-account-menu]')) document.querySelector('[data-action="toggle-account-menu"]').click();
      window.__fixtureBusyOverlaySeen = Boolean(document.querySelector('.busy-overlay'));
      window.__fixtureBusyObserver?.disconnect();
      window.__fixtureBusyObserver = new MutationObserver(() => {
        if (document.querySelector('.busy-overlay')) window.__fixtureBusyOverlaySeen = true;
      });
      window.__fixtureBusyObserver.observe(document.body, { childList: true, subtree: true });
      const button = document.querySelector('[data-action="switch-account"][data-user-id="${userId}"]');
      button.click();
      document.querySelector('[data-action="switch-account"][data-user-id="${userId}"]')?.click();
    })()`);
  };

  const callsBeforeRelogin = await window.webContents.executeJavaScript("window.hslFixture.getSwitchAccountCalls()");
  await observeSwitch("relogin");
  await waitFor(window, "document.querySelector('[data-auth-form]')");
  await waitForFrames(window, 3);
  const requiresLogin = await window.webContents.executeJavaScript(`(() => ({
    busyOverlaySeen: window.__fixtureBusyOverlaySeen,
    email: document.querySelector('#hsl-login-email')?.value,
    formVisible: Boolean(document.querySelector('[data-auth-form]')),
    message: document.querySelector('#hsl-login-error')?.textContent.trim(),
    menuOpen: Boolean(document.querySelector('[data-account-menu]')),
    controlsDisabled: [...document.querySelectorAll('[data-account-menu] button')].every((button) => button.disabled),
  }))()`);
  const callsAfterRelogin = await window.webContents.executeJavaScript("window.hslFixture.getSwitchAccountCalls()");
  requiresLogin.calls = callsAfterRelogin - callsBeforeRelogin;
  await capture(window, "account-requires-login-no-overlay.png");

  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"cancel-login\"]')?.click()");
  await waitForFrames(window);
  const callsBeforeExpired = await window.webContents.executeJavaScript("window.hslFixture.getSwitchAccountCalls()");
  await observeSwitch("expired");
  await waitFor(window, "document.querySelector('#hsl-login-email')?.value === 'expired@example.test'");
  await waitForFrames(window, 3);
  const unexpectedRelogin = await window.webContents.executeJavaScript(`(() => ({
    busyOverlaySeen: window.__fixtureBusyOverlaySeen,
    email: document.querySelector('#hsl-login-email')?.value,
    formVisible: Boolean(document.querySelector('[data-auth-form]')),
    menuOpen: Boolean(document.querySelector('[data-account-menu]')),
  }))()`);
  const callsAfterExpired = await window.webContents.executeJavaScript("window.hslFixture.getSwitchAccountCalls()");
  unexpectedRelogin.calls = callsAfterExpired - callsBeforeExpired;
  await capture(window, "account-unexpected-relogin.png");

  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"cancel-login\"]')?.click()");
  await waitForFrames(window);
  const callsBeforeValid = await window.webContents.executeJavaScript("window.hslFixture.getSwitchAccountCalls()");
  await observeSwitch("valid");
  await waitFor(window, "document.querySelector('[data-action=\"toggle-account-menu\"]')?.title.includes('valid@example.test')");
  await waitForFrames(window, 3);
  const valid = await window.webContents.executeJavaScript(`(() => ({
    busyOverlaySeen: window.__fixtureBusyOverlaySeen,
    menuOpen: Boolean(document.querySelector('[data-account-menu]')),
    sessionTitle: document.querySelector('[data-action="toggle-account-menu"]')?.title,
  }))()`);
  const callsAfterValid = await window.webContents.executeJavaScript("window.hslFixture.getSwitchAccountCalls()");
  valid.calls = callsAfterValid - callsBeforeValid;
  await capture(window, "account-valid-switch.png");
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="toggle-account-menu"]')?.click();
    document.querySelector('[data-action="add-account"]')?.click();
  })()`);
  await waitFor(window, "document.querySelector('[data-auth-form]')");
  const addAccount = await window.webContents.executeJavaScript(`(() => ({
    email: document.querySelector('#hsl-login-email')?.value,
    formVisible: Boolean(document.querySelector('[data-auth-form]')),
    menuOpen: Boolean(document.querySelector('[data-account-menu]')),
  }))()`);
  await window.webContents.executeJavaScript("window.__fixtureBusyObserver?.disconnect()");
  return { addAccount, requiresLogin, unexpectedRelogin, valid };
}

async function heroAndDrawerSmoke(window) {
  const readIndicators = () => window.webContents.executeJavaScript(`(() => ({
    indicators: [...document.querySelectorAll('.game-hero-indicator')].map((indicator) => ({
      labelWidth: indicator.querySelector('.game-hero-indicator__label').getBoundingClientRect().width,
      width: indicator.getBoundingClientRect().width,
    })),
    laneWidth: document.querySelector('.game-hero-indicators-region').getBoundingClientRect().width,
  }))()`);
  const readCloseButton = (drawer) => window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-action="close-overlay"]');
    const buttonRect = button.getBoundingClientRect();
    const icon = button.querySelector('.ui-icon');
    const image = icon.querySelector('.ui-icon__img');
    const glyph = icon.querySelector('.ui-icon__glyph');
    const fallback = icon.querySelector('.ui-icon__fallback');
    const iconRect = icon.getBoundingClientRect();
    const glyphStyle = getComputedStyle(glyph);
    const modalRect = document.querySelector('.modal-layer').getBoundingClientRect();
    const drawerRect = document.querySelector('.drawer-layer').getBoundingClientRect();
    return {
      drawer: ${JSON.stringify(drawer)},
      buttonHeight: buttonRect.height,
      buttonWidth: buttonRect.width,
      drawerBottom: drawerRect.bottom,
      drawerTop: drawerRect.top,
      fallbackDisplay: getComputedStyle(fallback).display,
      fallbackText: fallback.textContent,
      glyphBackground: glyphStyle.backgroundColor,
      glyphDisplay: glyphStyle.display,
      glyphMask: glyphStyle.maskImage || glyphStyle.webkitMaskImage,
      glyphTransform: glyphStyle.transform,
      iconColor: getComputedStyle(icon).color,
      iconHeight: iconRect.height,
      iconWidth: iconRect.width,
      imageComplete: image.complete && image.naturalWidth > 0,
      imageSource: image.getAttribute('src'),
      modalBottom: modalRect.bottom,
      modalTop: modalRect.top,
      viewportHeight: innerHeight,
      x: iconRect.left + iconRect.width / 2 - (buttonRect.left + buttonRect.width / 2),
      y: iconRect.top + iconRect.height / 2 - (buttonRect.top + buttonRect.height / 2),
    };
  })()`);
  const headerIcons = await window.webContents.executeJavaScript(`(() => {
    const measure = (selector) => {
      const button = document.querySelector(selector);
      const icon = button.querySelector('.ui-icon');
      const glyph = icon.querySelector('.ui-icon__glyph');
      const buttonRect = button.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      return {
        buttonHeight: buttonRect.height,
        buttonWidth: buttonRect.width,
        glyphTransform: getComputedStyle(glyph).transform,
        iconHeight: iconRect.height,
        iconWidth: iconRect.width,
        name: icon.dataset.icon,
      };
    };
    return {
      settings: measure('[data-action="show-settings"]'),
      theme: measure('[data-action="toggle-theme"]'),
    };
  })()`);
  window.setSize(1600, 820);
  await delay(40);
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'; document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '340px')");
  await waitForFrames(window);
  await capture(window, "hero-favorite-ready-expanded-dark.png");
  const expanded = await readIndicators();
  window.setSize(1200, 620);
  await delay(40);
  await window.webContents.executeJavaScript("document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '600px')");
  await waitForFrames(window);
  await capture(window, "hero-favorite-ready-compact-dark.png");
  const compact = await readIndicators();
  await window.webContents.executeJavaScript("window.hslFixture.emitHeroStatus('error')");
  await waitForFrames(window, 3);
  const errorIndicator = await window.webContents.executeJavaScript("document.querySelector('.game-hero-indicator--status')?.className || null");
  await capture(window, "hero-favorite-error-compact-dark.png");
  await window.webContents.executeJavaScript("window.hslFixture.emitHeroStatus('ready'); document.querySelector('[data-action=\"show-settings\"]')?.click()");
  await waitFor(window, "document.querySelector('[data-drawer]')");
  await waitFor(window, "document.querySelector('[data-action=\"close-overlay\"] .ui-icon--loaded')");
  await captureNativeWindow(window, "drawer-settings-close.png");
  const closeButtons = [await readCloseButton("settings")];
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"close-overlay\"]')?.click(); document.querySelector('[data-action=\"show-activity-details\"]')?.click()");
  await waitFor(window, "document.querySelector('[data-drawer]')");
  await waitFor(window, "document.querySelector('[data-action=\"close-overlay\"] .ui-icon--loaded')");
  await captureNativeWindow(window, "drawer-activity-close.png");
  closeButtons.push(await readCloseButton("activity"));
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"close-overlay\"]')?.click()");
  return { closeButtons, compact, errorIndicator, expanded, headerIcons };
}

async function microinteractionSmoke(window) {
  const movePointerTo = async (selector, xRatio = 0.5, yRatio = 0.5) => {
    const coordinates = await window.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width * ${xRatio}),
        y: Math.round(rect.top + rect.height * ${yRatio}),
      };
    })()`);
    window.webContents.sendInputEvent({ type: "mouseMove", ...coordinates });
    await delay(40);
    await waitForFrames(window);
  };
  const movePointerAway = async () => {
    window.webContents.sendInputEvent({ type: "mouseMove", x: 4, y: 400 });
    await delay(30);
    await waitForFrames(window);
  };
  const readHero = () => window.webContents.executeJavaScript(`(() => ({
    indicators: [...document.querySelectorAll('.game-hero-indicator')].map((indicator) => {
      const rect = indicator.getBoundingClientRect();
      const icon = indicator.querySelector('.game-hero-indicator__icon').getBoundingClientRect();
      const label = indicator.querySelector('.game-hero-indicator__label');
      return {
        centerOffsetY: icon.top + icon.height / 2 - (rect.top + rect.height / 2),
        className: indicator.className,
        height: rect.height,
        iconHeight: icon.height,
        iconWidth: icon.width,
        label: label?.textContent.trim() || null,
        labelWidth: label?.getBoundingClientRect().width || 0,
        width: rect.width,
      };
    }),
    laneWidth: document.querySelector('.game-hero-indicators-region').getBoundingClientRect().width,
  }))()`);
  const readStyle = (selector) => window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const style = getComputedStyle(element);
    return {
      background: style.background,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      color: style.color,
      height: style.height,
      transform: style.transform,
      width: style.width,
    };
  })()`);
  const results = {};

  for (const theme of ["dark", "light"]) {
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    window.setSize(1500, 820);
    await delay(50);
    await window.webContents.executeJavaScript("document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '380px')");
    await waitForFrames(window);
    results[theme] = { accounts: {}, connection: {}, hero: {}, play: {} };

    for (const status of ["ready", "error", "checking"]) {
      await window.webContents.executeJavaScript(`window.hslFixture.emitHeroStatus(${JSON.stringify(status)})`);
      await waitForFrames(window, 3);
      await capture(window, `micro-hero-${status}-${theme}.png`);
      const resize = [];
      for (const [width, sidebarWidth] of [[1600, 340], [1500, 400], [1400, 460], [1300, 520], [1200, 600]]) {
        window.setSize(width, 820);
        await delay(35);
        await window.webContents.executeJavaScript(`document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '${sidebarWidth}px')`);
        await waitForFrames(window);
        resize.push({ sidebarWidth, width, ...(await readHero()) });
      }
      results[theme].hero[status] = resize;
    }

    await window.webContents.executeJavaScript("window.hslFixture.emitHeroStatus('ready')");
    window.setSize(1400, 820);
    await delay(50);
    await window.webContents.executeJavaScript("document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '440px')");
    await waitForFrames(window, 3);

    await movePointerAway();
    results[theme].play.idle = await readStyle('.play-button');
    await capture(window, `micro-play-idle-${theme}.png`);
    await movePointerTo('.play-button');
    results[theme].play.hover = await readStyle('.play-button');
    await capture(window, `micro-play-hover-${theme}.png`);

    await movePointerAway();
    await window.webContents.executeJavaScript("document.querySelector('[data-action=\"toggle-account-menu\"]')?.click() ");
    await waitFor(window, "document.querySelector('[data-account-menu]')");
    await waitForFrames(window);
    results[theme].accounts.idle = await readStyle('.account-row:not(.account-row--active) .account-row__surface');
    await movePointerTo('[data-action="switch-account"][data-user-id="valid"]', 0.4);
    results[theme].accounts.hover = await readStyle('.account-row:not(.account-row--active) .account-row__surface');
    await capture(window, `micro-account-hover-${theme}.png`);
    await movePointerTo('[data-action="remove-known-account"][data-user-id="valid"]');
    results[theme].accounts.forget = await readStyle('[data-action="remove-known-account"][data-user-id="valid"]');
    await capture(window, `micro-account-forget-hover-${theme}.png`);
    await window.webContents.executeJavaScript("document.querySelector('[data-action=\"toggle-account-menu\"]')?.click() ");
    await waitForFrames(window);

    for (const status of ["connected", "disconnected"]) {
      await window.webContents.executeJavaScript(`window.hslFixture.emitConnectivityStatus(${JSON.stringify(status)})`);
      await waitForFrames(window, 3);
      const chip = await readStyle('.connection-chip');
      const dot = await readStyle('.connection-dot');
      results[theme].connection[status] = { chip, dot };
      await capture(window, `micro-connection-${status}-${theme}.png`);
    }
  }

  return results;
}

async function calendarCompanionSmoke(window) {
  const measure = (selector) => window.webContents.executeJavaScript(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)});
    const icon = row.querySelector('.text-companion-icon');
    const glyph = icon.querySelector('.ui-icon__glyph');
    const text = row.querySelector(':scope > .pack-card__subtitle-text, :scope > span:last-child');
    const iconRect = icon.getBoundingClientRect();
    const glyphRect = glyph.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const textStyle = getComputedStyle(text);
    const baselineProbe = document.createElement('span');
    baselineProbe.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;vertical-align:baseline';
    row.append(baselineProbe);
    const baseline = baselineProbe.getBoundingClientRect().top;
    baselineProbe.remove();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = textStyle.font;
    const capHeight = context.measureText('H').actualBoundingBoxAscent;
    return {
      baseline,
      bottomDelta: iconRect.bottom - baseline,
      capHeight,
      capSupported: CSS.supports('height', '1cap'),
      glyph: { bottom: glyphRect.bottom, height: glyphRect.height, top: glyphRect.top },
      icon: { bottom: iconRect.bottom, height: iconRect.height, top: iconRect.top, width: iconRect.width },
      lineHeight: textStyle.lineHeight,
      text: { bottom: textRect.bottom, height: textRect.height, top: textRect.top, value: text.textContent.trim() },
      topDelta: iconRect.top - (baseline - capHeight),
    };
  })()`);

  window.setSize(1400, 860);
  await delay(60);
  await window.webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.theme = 'light';
    document.querySelector('[data-action="set-library-view"][data-view="covers"]')?.click();
    document.querySelector('[data-render-region="library-packs"]').scrollTop = 0;
  })()`);
  await waitForFrames(window);
  const covers = await measure('.pack-card[data-instance-key="instance-0"] .pack-card__subtitle');
  await capture(window, 'calendar-covers-semana-1-light.png');

  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="set-library-view"][data-view="list"]')?.click();
    document.querySelector('[data-render-region="library-packs"]').scrollTop = 0;
  })()`);
  await waitForFrames(window);
  const list = await measure('.pack-card[data-instance-key="instance-1"] .pack-card__subtitle');
  await capture(window, 'calendar-list-pack-desarrollo-light.png');
  const detail = await measure('.game-week-subtitle');
  await capture(window, 'calendar-detail-semana-1-light.png');
  return { covers, detail, list };
}

async function brandedFallbackSmoke(window) {
  const render = async ({ filename, mode, theme }) => {
    const metrics = await window.webContents.executeJavaScript(`(async () => {
      const { renderGamePanel } = await import('./components/game-panel.js');
      const populated = ${JSON.stringify({ instanceKey: "fixture-brand-pack", status: "ok", title: "Fixture brand pack" })};
      const state = {
        busy: false,
        data: {
          game: null,
          library: {
            directory: { available: true, configured: true, path: 'C:/fixture-packs' },
            packs: ${JSON.stringify(mode)} === 'no-selection' ? [populated] : [],
            status: ${JSON.stringify(mode)} === 'no-selection' ? 'available-populated' : 'available-empty',
          },
          selection: { activeInstanceKey: null },
        },
      };
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      document.querySelector('[data-render-region="game-panel"]').innerHTML = renderGamePanel(state);
      const logo = document.querySelector('[data-hsl-fallback-logo]');
      await (logo.complete ? Promise.resolve() : new Promise((resolve) => logo.addEventListener('load', resolve, { once: true })));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const shell = document.querySelector('.game-hero-shell--brand');
      const safe = shell.querySelector('.game-hero-logo-safe-area');
      const shellRect = shell.getBoundingClientRect();
      const safeRect = safe.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      const shellStyle = getComputedStyle(shell);
      return {
        afterContent: getComputedStyle(shell, '::after').content,
        backgroundColor: shellStyle.backgroundColor,
        backgroundImage: shellStyle.backgroundImage,
        boxShadow: shellStyle.boxShadow,
        centeredX: Math.abs((logoRect.left + logoRect.width / 2) - (shellRect.left + shellRect.width / 2)),
        centeredY: Math.abs((logoRect.top + logoRect.height / 2) - (shellRect.top + shellRect.height / 2)),
        contained: logoRect.left >= safeRect.left && logoRect.right <= safeRect.right && logoRect.top >= safeRect.top && logoRect.bottom <= safeRect.bottom,
        logo: { height: logoRect.height, width: logoRect.width },
        mode: ${JSON.stringify(mode)},
        objectFit: getComputedStyle(logo).objectFit,
        safe: { height: safeRect.height, width: safeRect.width },
        source: logo.getAttribute('src'),
        theme: ${JSON.stringify(theme)},
      };
    })()`);
    await capture(window, filename);
    return metrics;
  };

  window.setSize(1400, 860);
  await delay(60);
  const results = [];
  for (const theme of ['dark', 'light']) {
    results.push(await render({ filename: `hero-fallback-empty-${theme}.png`, mode: 'empty', theme }));
    results.push(await render({ filename: `hero-fallback-no-selection-${theme}.png`, mode: 'no-selection', theme }));
  }
  return results;
}

async function finalPolishSmoke(window) {
  const calendar = await calendarCompanionSmoke(window);
  const heroAndDrawers = await heroAndDrawerSmoke(window);
  const fallback = await brandedFallbackSmoke(window);
  const chrome = await nativeChromeMetrics(window);
  return { calendar, chrome, fallback, heroAndDrawers };
}

async function footerResizeMetrics(window) {
  const initial = window.getBounds();
  const read = () => window.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, height: value.height };
    };
    resolve({
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      shell: rect('.app-shell'),
      main: rect('.app-main'),
      footer: rect('.launcher-footer'),
    });
  }))`);
  const bottomResize = [];
  const topResize = [];
  const fixedBottom = initial.y + 660;

  for (let height = 620; height <= 640; height += 2) {
    window.setBounds({ x: initial.x, y: initial.y, width: 1200, height });
    await delay(20);
    bottomResize.push({ bounds: window.getBounds(), dom: await read() });
  }
  for (let height = 620; height <= 640; height += 2) {
    window.setBounds({ x: initial.x, y: fixedBottom - height, width: 1200, height });
    await delay(20);
    topResize.push({ bounds: window.getBounds(), dom: await read() });
  }
  return { bottomResize, topResize };
}

async function captureSmokeViews(window) {
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'");
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="set-library-view"][data-view="icons"]')?.click();
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    const active = document.querySelector('.pack-card[data-selected="true"]');
    scroller.scrollTop = Math.max(0, active.offsetTop - scroller.clientHeight + active.offsetHeight + 8);
  })()`);
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(resolve))");
  await capture(window, "library-icons-dark.png");
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="set-library-view"][data-view="covers"]')?.click();
    document.querySelector('[data-render-region="library-packs"]').scrollTop = 0;
  })()`);
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(resolve))");
  await capture(window, "library-covers-dark.png");
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="set-library-view"][data-view="list"]')?.click();
    document.querySelector('[data-render-region="library-packs"]').scrollTop = 0;
  })()`);
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(resolve))");
  await capture(window, "library-list-light.png");
  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-action="set-library-view"][data-view="covers"]')?.click();
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    const active = document.querySelector('.pack-card[data-selected="true"]');
    scroller.scrollTop = Math.max(0, active.offsetTop - scroller.clientHeight + active.offsetHeight + 8);
  })()`);
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(resolve))");
  await capture(window, "library-covers-light.png");
}

async function alphaAwareLibrarySmoke(window) {
  const cacheStats = () => window.webContents.executeJavaScript(`import(
    new URL('./library-art-presentation.js', location.href).href
  ).then((module) => module.getLibraryArtPresentationCacheStats())`);
  const setView = async (view) => {
    await window.webContents.executeJavaScript(`document.querySelector(
      '[data-action="set-library-view"][data-view="${view}"]'
    )?.click()`);
    await waitFor(window, `[...document.querySelectorAll('.pack-card')].every((card) =>
      card.matches('.pack-card--${view}') && card.querySelector('.pack-card__media')?.classList.contains('asset-ready')
    )`);
    await waitForFrames(window, 2);
  };
  const readCards = () => window.webContents.executeJavaScript(`(() => (
    [...document.querySelectorAll('.pack-card')].slice(0, 5).map((card) => {
      const image = card.querySelector('.pack-card__art');
      const media = card.querySelector('.pack-card__media');
      const imageStyle = getComputedStyle(image);
      const imageRect = image.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      return {
        imageRect: { height: imageRect.height, width: imageRect.width, x: imageRect.x, y: imageRect.y },
        instanceKey: card.dataset.instanceKey,
        kind: image.dataset.assetKind,
        mediaRect: { height: mediaRect.height, width: mediaRect.width, x: mediaRect.x, y: mediaRect.y },
        natural: { height: image.naturalHeight, width: image.naturalWidth },
        filter: imageStyle.filter,
        objectFit: imageStyle.objectFit,
        padding: {
          bottom: Number.parseFloat(imageStyle.paddingBottom),
          left: Number.parseFloat(imageStyle.paddingLeft),
          right: Number.parseFloat(imageStyle.paddingRight),
          top: Number.parseFloat(imageStyle.paddingTop),
        },
        presentation: media.dataset.artPresentation,
        rendered: !image.hidden && image.dataset.assetStatus === 'loaded',
      };
    })
  ))()`);

  const initial = {
    cache: await cacheStats(),
    view: await window.webContents.executeJavaScript("document.querySelector('.pack-card')?.className"),
  };

  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'");
  await setView("list");
  const listDark = { cache: await cacheStats(), cards: await readCards() };
  await capture(window, "library-alpha-list-dark.png");

  await setView("icons");
  const iconsDark = { cache: await cacheStats(), cards: await readCards() };
  await capture(window, "library-alpha-icons-dark.png");

  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
  await waitForFrames(window, 2);
  const iconsLight = { cache: await cacheStats(), cards: await readCards() };
  await capture(window, "library-alpha-icons-light.png");

  await setView("list");
  const listLight = { cache: await cacheStats(), cards: await readCards() };
  await capture(window, "library-alpha-list-light.png");

  const selectionSetup = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    const cards = [...scroller.querySelectorAll('.pack-card')].slice(0, 5);
    scroller.scrollTop = 96;
    window.__hslAlphaSelectionRefs = {
      cards: cards.map((card) => ({
        card,
        image: card.querySelector('.pack-card__art'),
        instanceKey: card.dataset.instanceKey,
        presentation: card.querySelector('.pack-card__media').dataset.artPresentation,
      })),
      scroller,
    };
    cards[1].click();
    return { scrollTop: scroller.scrollTop, target: cards[1].dataset.instanceKey };
  })()`);
  await waitFor(window, `document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey === ${JSON.stringify("instance-1")}
    && !document.querySelector('.pack-card--pending')`);
  await waitForFrames(window, 3);
  const selection = await window.webContents.executeJavaScript(`(() => {
    const refs = window.__hslAlphaSelectionRefs;
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    const cards = [...scroller.querySelectorAll('.pack-card')];
    return {
      cardsSame: refs.cards.every((ref) => ref.card === cards.find((card) => card.dataset.instanceKey === ref.instanceKey)),
      imagesSame: refs.cards.every((ref) => ref.image === cards.find((card) => card.dataset.instanceKey === ref.instanceKey)?.querySelector('.pack-card__art')),
      presentationsSame: refs.cards.every((ref) => ref.presentation === cards.find((card) => card.dataset.instanceKey === ref.instanceKey)?.querySelector('.pack-card__media')?.dataset.artPresentation),
      scrollerSame: refs.scroller === scroller,
      scrollTop: scroller.scrollTop,
    };
  })()`);
  selection.initialScrollTop = selectionSetup.scrollTop;
  selection.target = selectionSetup.target;
  selection.cache = await cacheStats();

  window.setSize(1200, 680);
  await delay(40);
  await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    scroller.scrollTop += 80;
    const card = document.querySelector('.pack-card');
    card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.documentElement.dataset.theme = 'dark';
  })()`);
  await waitForFrames(window, 3);
  const passiveInteractions = {
    cache: await cacheStats(),
    cards: await readCards(),
    size: window.getSize(),
  };

  return { iconsDark, iconsLight, initial, listDark, listLight, passiveInteractions, selection };
}

async function nativeChromeMetrics(window) {
  const read = () => window.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.window-titlebar');
    const icon = bar.querySelector('.window-titlebar__icon');
    const title = bar.querySelector('.window-titlebar__title');
    const style = getComputedStyle(bar);
    const before = getComputedStyle(bar, '::before');
    const after = getComputedStyle(bar, '::after');
    const safeAreaProbe = document.createElement('span');
    safeAreaProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:env(titlebar-area-x,0px);top:env(titlebar-area-y,0px);width:env(titlebar-area-width,100vw);height:env(titlebar-area-height,var(--native-titlebar-height))';
    document.body.append(safeAreaProbe);
    const safeAreaRect = safeAreaProbe.getBoundingClientRect();
    safeAreaProbe.remove();
    const barRect = bar.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    return {
      after: {
        backgroundColor: after.backgroundColor,
        backgroundImage: after.backgroundImage,
        boxShadow: after.boxShadow,
        left: Number.parseFloat(after.left),
        pointerEvents: after.pointerEvents,
        width: Number.parseFloat(after.width),
      },
      background: style.backgroundColor,
      before: {
        backgroundColor: before.backgroundColor,
        backgroundImage: before.backgroundImage,
        boxShadow: before.boxShadow,
        left: Number.parseFloat(before.left),
        pointerEvents: before.pointerEvents,
        width: Number.parseFloat(before.width),
      },
      borderBottomColor: style.borderBottomColor,
      borderBottomWidth: style.borderBottomWidth,
      dragRegion: style.webkitAppRegion,
      height: barRect.height,
      iconLoaded: icon.complete && icon.naturalWidth > 0,
      innerWidth,
      safeArea: {
        height: safeAreaRect.height,
        width: safeAreaRect.width,
        x: safeAreaRect.x,
        y: safeAreaRect.y,
      },
      title: title.textContent.trim(),
      titleContained: titleRect.top >= barRect.top && titleRect.bottom <= barRect.bottom,
      titleLineHeight: getComputedStyle(title).lineHeight,
    };
  })()`);
  window.setSize(1600, 820);
  await delay(60);
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'");
  window.setTitleBarOverlay(titleBarOverlay("dark"));
  moveSystemCursorOverWindow(window, 420, 16);
  await waitForFrames(window);
  const dark = await read();
  await captureNativeWindow(window, "native-titlebar-normal-dark.png");
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
  window.setTitleBarOverlay(titleBarOverlay("light"));
  moveSystemCursorOverWindow(window, 420, 16);
  await waitForFrames(window);
  const light = await read();
  await captureNativeWindow(window, "native-titlebar-normal-light.png");

  const hoverCaptures = [];
  let nativeActions = null;
  if (process.platform === "win32") {
    const rightClusterWidth = light.innerWidth - light.safeArea.x - light.safeArea.width;
    const leftClusterWidth = light.safeArea.x;
    const controlsOnRight = rightClusterWidth >= leftClusterWidth;
    const clusterWidth = Math.max(leftClusterWidth, rightClusterWidth);
    const clusterStart = controlsOnRight ? light.safeArea.x + light.safeArea.width : 0;
    const cellWidth = clusterWidth / 3;
    for (const [index, name] of ["minimize", "maximize", "close"].entries()) {
      const visualIndex = controlsOnRight ? index : 2 - index;
      moveSystemCursorOverWindow(window, clusterStart + (visualIndex + 0.5) * cellWidth, 16);
      await delay(180);
      await captureNativeWindow(window, `native-titlebar-hover-${name}-light.png`);
      hoverCaptures.push({ cellWidth, clusterWidth, controlsOnRight, name });
    }
    if (process.env.HSL_NATIVE_CONTROL_ACTIONS === "1") {
      const minimizeX = clusterStart + 0.5 * cellWidth;
      const maximizeX = clusterStart + 1.5 * cellWidth;
      moveSystemCursorOverWindow(window, minimizeX, 16, true);
      await delay(280);
      const minimized = window.isMinimized();
      window.restore();
      window.show();
      window.focus();
      await delay(180);
      moveSystemCursorOverWindow(window, maximizeX, 16, true);
      await delay(280);
      const maximized = window.isMaximized();
      window.unmaximize();
      await delay(180);
      nativeActions = { closeActivated: false, maximized, minimized };
    }
  }

  window.setSize(1900, 900);
  await delay(60);
  moveSystemCursorOverWindow(window, 420, 16);
  await waitForFrames(window);
  const rails = await window.webContents.executeJavaScript(`(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const before = getComputedStyle(element, '::before');
      const after = getComputedStyle(element, '::after');
      return {
        afterBackground: after.backgroundColor,
        afterPointerEvents: after.pointerEvents,
        left: rect.left,
        right: rect.right,
        beforeBackground: before.backgroundColor,
        beforePointerEvents: before.pointerEvents,
      };
    };
    return {
      bodyScrollWidth: document.body.scrollWidth,
      header: measure('.launcher-header'),
      innerWidth,
      main: measure('.app-main'),
    };
  })()`);
  await captureNativeWindow(window, "native-shell-wide-rails.png");
  if (nativeActions) {
    const closePromise = new Promise((resolve) => window.once("closed", () => resolve(true)));
    moveSystemCursorOverWindow(window, window.getBounds().width - hoverCaptures[0].cellWidth / 2, 16, true);
    nativeActions.closeActivated = await Promise.race([closePromise, delay(800).then(() => false)]);
  }
  return { applicationMenu: Menu.getApplicationMenu(), dark, hoverCaptures, light, nativeActions, rails };
}

async function detailScrollMetrics(window) {
  const measure = async ({ filename, height, sidebarWidth, width }) => {
    window.setSize(width, height);
    await delay(40);
    await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '${sidebarWidth}px');
      const scroll = document.querySelector('.game-scroll');
      scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
    })()`);
    await waitForFrames(window);
    const metrics = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.game-detail-card');
      const scroll = document.querySelector('.game-scroll');
      const cardRect = card.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const spacer = getComputedStyle(scroll, '::after');
      return {
        atMaximum: Math.abs(scroll.scrollTop - (scroll.scrollHeight - scroll.clientHeight)) <= 1,
        bottomGap: scrollRect.bottom - cardRect.bottom,
        clientHeight: scroll.clientHeight,
        detailWidth: scrollRect.width,
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        gameScrollTop: scroll.scrollTop,
        gridAutoFlow: getComputedStyle(scroll).gridAutoFlow,
        gridTemplateRows: getComputedStyle(scroll).gridTemplateRows,
        hasOverflow: scroll.scrollHeight > scroll.clientHeight,
        cardHeight: card.offsetHeight,
        cardOffsetTop: card.offsetTop,
        scrollHeight: scroll.scrollHeight,
        spacerDisplay: spacer.display,
        spacerHeight: spacer.height,
        terminalExtent: scroll.scrollHeight - (card.offsetTop + card.offsetHeight),
      };
    })()`);
    await capture(window, filename);
    return { ...metrics, outerBounds: window.getBounds() };
  };

  return {
    comfortable: await measure({ filename: "detail-comfortable-light.png", height: 1200, sidebarWidth: 440, width: 1240 }),
    minimum: await measure({ filename: "detail-bottom-minimum-light.png", height: 620, sidebarWidth: 600, width: 1200 }),
    userLike: await measure({ filename: "detail-bottom-user-like-light.png", height: 700, sidebarWidth: 440, width: 1240 }),
  };
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (checkOnly === "alpha") prepareAlphaFixtureAssets();
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1200,
    minHeight: 620,
    icon: path.join(__dirname, "..", "gui", "renderer", "assets", "native", "app-icon.ico"),
    show: Boolean(screenshotDirectory) || traceVisible || resizeOnly,
    titleBarOverlay: titleBarOverlay("dark"),
    titleBarStyle: "hidden",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "library-browserwindow-fixture-preload.cjs"),
      sandbox: true,
    },
  });

  try {
    await window.loadURL(pathToFileURL(rendererDocument).href);
    await waitFor(window, "document.querySelectorAll('.pack-card').length === 40");
    await waitFor(window, "!document.querySelector('.busy-overlay')", 12_000);
    await window.webContents.executeJavaScript("document.querySelector('[data-render-region=\"library-packs\"]').dataset.fixtureIdentity = 'library-packs-node'");
    if (checkOnly) {
      const checks = {
        accounts: () => accountMetrics(window),
        alpha: () => alphaAwareLibrarySmoke(window),
        calendar: () => calendarCompanionSmoke(window),
        chrome: () => nativeChromeMetrics(window),
        detail: () => detailScrollMetrics(window),
        filters: () => filterScrollMetrics(window),
        hero: () => heroAndDrawerSmoke(window),
        icons: () => iconAlphaMetrics(window),
        microinteractions: () => microinteractionSmoke(window),
        polish: () => finalPolishSmoke(window),
        rows: () => iconRows(window),
        signals: async () => ({ hostile: await hostileSignalMetrics(window), shared: await signalMetrics(window) }),
      };
      if (!checks[checkOnly]) throw new Error(`Unknown check: ${checkOnly}`);
      const checkResult = await checks[checkOnly]();
      const serializedResult = JSON.stringify(checkResult);
      if (screenshotDirectory) fs.writeFileSync(path.join(screenshotDirectory, "smoke-metrics.json"), serializedResult);
      process.stdout.write(`${serializedResult}\n`);
      return;
    }
    if (resizeOnly) {
      process.stdout.write(`${JSON.stringify(await footerResizeMetrics(window))}\n`);
      return;
    }
    if (traceOnly) {
      const selection = await stage("covers-bottom", () => selectVisiblePack(window, { nearBottom: true, view: "covers" }));
      process.stdout.write(`${JSON.stringify({ selections: [selection] })}\n`);
      return;
    }
    const selections = [
      await stage("covers-middle", () => selectVisiblePack(window, { requestedTop: 600, view: "covers" })),
      await stage("covers-bottom", () => selectVisiblePack(window, { nearBottom: true, view: "covers" })),
      await stage("list-middle", () => selectVisiblePack(window, { requestedTop: 600, view: "list" })),
      await stage("list-bottom", () => selectVisiblePack(window, { nearBottom: true, view: "list" })),
      await stage("icons-middle", () => selectVisiblePack(window, { requestedTop: 600, view: "icons" })),
      await stage("icons-bottom", () => selectVisiblePack(window, { nearBottom: true, view: "icons" })),
      await stage("covers-repeat", () => selectVisiblePack(window, { requestedTop: 900, view: "covers" })),
    ];
    window.setSize(1200, 620);
    await delay(40);
    const samePackDetail = await stage("same-pack", () => window.webContents.executeJavaScript(`(() => {
      const scroll = document.querySelector('.game-scroll');
      scroll.scrollTop = 120;
      window.hslFixture.emitSamePackSnapshot();
      return new Promise((resolve) => requestAnimationFrame(() => resolve(scroll.scrollTop)));
    })()`));
    await window.webContents.executeJavaScript("document.querySelector('[data-action=\"set-library-view\"][data-view=\"covers\"]')?.click()");
    await delay(30);
    const visualsDark = await stage("visuals-dark", () => visualMetrics(window));
    await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
    await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(resolve))");
    const visualsLight = await stage("visuals-light", () => visualMetrics(window));
    await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'");
    const signals = await stage("signals", () => signalMetrics(window));
    const rows = await stage("rows", () => iconRows(window));
    const filters = await stage("filters", () => filterScrollMetrics(window));
    const hostileSignals = await stage("hostile-signals", () => hostileSignalMetrics(window));
    const accounts = await stage("accounts", () => accountMetrics(window));
    const chrome = await stage("chrome", () => nativeChromeMetrics(window));
    const heroAndDrawers = await stage("hero-and-drawers", () => heroAndDrawerSmoke(window));
    await stage("captures", () => captureSmokeViews(window));
    await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
    const detail = await stage("detail", () => detailScrollMetrics(window));
    const footer = await stage("footer", () => footerResizeMetrics(window));
    const result = {
      accounts,
      chrome,
      detail,
      filters,
      footer,
      heroAndDrawers,
      hostileSignals,
      icons: await iconAlphaMetrics(window),
      rows,
      samePackDetail,
      selections,
      signals,
      visuals: { dark: visualsDark, light: visualsLight },
    };
    process.stdout.write(`${JSON.stringify(quietOutput ? {
      gpuEnabled: process.env.HSL_LIBRARY_USE_GPU === "1",
      screenshotDirectory,
      screenshotFiles: screenshotDirectory ? fs.readdirSync(screenshotDirectory).sort() : [],
    } : result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    if (!window.isDestroyed()) window.destroy();
    if (alphaFixtureDirectory?.startsWith(os.tmpdir())) {
      fs.rmSync(alphaFixtureDirectory, { force: true, recursive: true });
    }
    app.exit(process.exitCode || 0);
  }
});

app.on("window-all-closed", () => {});
