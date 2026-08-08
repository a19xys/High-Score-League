const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu } = require("electron");

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return {
      label: ${JSON.stringify(label)},
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      identity: scroller.dataset.fixtureIdentity,
      selected: document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey || null,
      pending: document.querySelector('.pack-card--pending')?.dataset.instanceKey || null,
      detailScrollTop: document.querySelector('.game-scroll').scrollTop,
    };
  })()`);
}

async function beginFrameTrace(window) {
  await window.webContents.executeJavaScript(`(() => {
    const measure = () => {
      const scroller = document.querySelector('[data-render-region="library-packs"]');
      const scrollerRect = scroller.getBoundingClientRect();
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
      return {
        frame: window.__hslFrameTrace?.length || 0,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
        identity: scroller.dataset.fixtureIdentity,
        view: document.querySelector('[data-action="set-library-view"].view-button--active')?.dataset.view || null,
        selected: document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey || null,
        pending: document.querySelector('.pack-card--pending')?.dataset.instanceKey || null,
        cards,
        rowTops,
      };
    };
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
      resolve(window.__hslFrameTrace);
    })));
  })`);
}

function summarizeFrameTrace(frames) {
  const geometryTransitions = [];

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

  return {
    frameTrace: frames.map(({ cards, rowTops, ...frame }) => frame),
    geometryTransitions,
  };
}

async function selectVisiblePack(window, { nearBottom = false, requestedTop = 600, view = "covers" } = {}) {
  await window.webContents.executeJavaScript(`document.querySelector('[data-action="set-library-view"][data-view="${view}"]')?.click()`);
  await delay(40);
  const setup = await window.webContents.executeJavaScript(`(() => {
    const scroller = document.querySelector('[data-render-region="library-packs"]');
    scroller.dataset.fixtureIdentity ||= 'library-packs-node';
    scroller.scrollTop = ${nearBottom
      ? "Math.max(0, scroller.scrollHeight - scroller.clientHeight - 2)"
      : `Math.min(${requestedTop}, scroller.scrollHeight - scroller.clientHeight - 80)`};
    const bounds = scroller.getBoundingClientRect();
    const candidates = [...scroller.querySelectorAll('[data-action="use-library-pack"]')]
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom >= bounds.top + 40 && rect.top <= bounds.bottom - 40;
      });
    const target = candidates.at(-1) || candidates[0];
    return { instanceKey: target.dataset.instanceKey, scrollTop: scroller.scrollTop };
  })()`);
  await window.webContents.executeJavaScript("document.querySelector('.game-scroll').scrollTop = 160");
  const trace = [await sample(window, "A-before-click")];
  await beginFrameTrace(window);
  await window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll('[data-action="use-library-pack"]')]
      .find((card) => card.dataset.instanceKey === ${JSON.stringify(setup.instanceKey)});
    target.click();
  })()`);
  await waitFor(window, "document.querySelector('.pack-card--pending')");
  trace.push(await sample(window, "B-pending"));
  await waitFor(window, `document.querySelector('.pack-card[data-selected="true"]')?.dataset.instanceKey === ${JSON.stringify(setup.instanceKey)} && !document.querySelector('.pack-card--pending')`);
  trace.push(await sample(window, "C-accepted"));
  await waitFor(window, "document.querySelector('[data-render-region=\"game-identity\"]')?.textContent.includes('REFRESH')");
  trace.push(await sample(window, "D-refresh"));
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(resolve))");
  trace.push(await sample(window, "E-one-frame"));
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  trace.push(await sample(window, "F-two-frames-assets"));
  const frameDiagnostics = summarizeFrameTrace(await endFrameTrace(window));
  return { ...frameDiagnostics, initialScrollTop: setup.scrollTop, nearBottom, trace, view };
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
  await capture(window, "drawer-settings-close.png");
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"close-overlay\"]')?.click(); document.querySelector('[data-action=\"show-activity-details\"]')?.click()");
  await waitFor(window, "document.querySelector('[data-drawer]')");
  await capture(window, "drawer-activity-close.png");
  const closeButtons = await window.webContents.executeJavaScript(`(() => [...document.querySelectorAll('[data-action="close-overlay"]')].map((button) => {
    const buttonRect = button.getBoundingClientRect();
    const icon = button.querySelector('.ui-icon');
    const glyph = icon.querySelector('.ui-icon__glyph');
    const fallback = icon.querySelector('.ui-icon__fallback');
    const iconRect = icon.getBoundingClientRect();
    const glyphStyle = getComputedStyle(glyph);
    return {
      fallbackDisplay: getComputedStyle(fallback).display,
      glyphBackground: glyphStyle.backgroundColor,
      glyphDisplay: glyphStyle.display,
      glyphMask: glyphStyle.maskImage || glyphStyle.webkitMaskImage,
      glyphTransform: glyphStyle.transform,
      iconColor: getComputedStyle(icon).color,
      x: iconRect.left + iconRect.width / 2 - (buttonRect.left + buttonRect.width / 2),
      y: iconRect.top + iconRect.height / 2 - (buttonRect.top + buttonRect.height / 2),
    };
  }))()`);
  await window.webContents.executeJavaScript("document.querySelector('[data-action=\"close-overlay\"]')?.click()");
  return { closeButtons, compact, errorIndicator, expanded };
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

async function nativeChromeMetrics(window) {
  const read = () => window.webContents.executeJavaScript(`(() => {
    const bar = document.querySelector('.window-titlebar');
    const icon = bar.querySelector('.window-titlebar__icon');
    const style = getComputedStyle(bar);
    return {
      background: style.backgroundColor,
      dragRegion: style.webkitAppRegion,
      height: bar.getBoundingClientRect().height,
      iconLoaded: icon.complete && icon.naturalWidth > 0,
      title: bar.querySelector('.window-titlebar__title').textContent.trim(),
    };
  })()`);
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'");
  window.setTitleBarOverlay({ color: "#0f172a", height: 32, symbolColor: "#f8fafc" });
  await waitForFrames(window);
  const dark = await read();
  await capture(window, "native-titlebar-dark.png");
  await window.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
  window.setTitleBarOverlay({ color: "#eef4fb", height: 32, symbolColor: "#0f172a" });
  await waitForFrames(window);
  const light = await read();
  await capture(window, "native-titlebar-light.png");
  return { applicationMenu: Menu.getApplicationMenu(), dark, light };
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
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1200,
    minHeight: 620,
    icon: path.join(__dirname, "..", "gui", "renderer", "assets", "native", "app-icon.ico"),
    show: Boolean(screenshotDirectory) || traceVisible || resizeOnly,
    titleBarOverlay: { color: "#0f172a", height: 32, symbolColor: "#f8fafc" },
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
        chrome: () => nativeChromeMetrics(window),
        detail: () => detailScrollMetrics(window),
        filters: () => filterScrollMetrics(window),
        hero: () => heroAndDrawerSmoke(window),
        icons: () => iconAlphaMetrics(window),
        rows: () => iconRows(window),
        signals: async () => ({ hostile: await hostileSignalMetrics(window), shared: await signalMetrics(window) }),
      };
      if (!checks[checkOnly]) throw new Error(`Unknown check: ${checkOnly}`);
      process.stdout.write(`${JSON.stringify(await checks[checkOnly]())}\n`);
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
    window.destroy();
    app.exit(process.exitCode || 0);
  }
});

app.on("window-all-closed", () => {});
