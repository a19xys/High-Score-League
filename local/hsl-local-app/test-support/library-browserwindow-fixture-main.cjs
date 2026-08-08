const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow } = require("electron");

const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hsl-library-browserwindow-"));
app.setPath("userData", profileDirectory);
app.commandLine.appendSwitch("disk-cache-dir", path.join(profileDirectory, "cache"));
app.commandLine.appendSwitch("disable-gpu");

const rendererDocument = path.join(__dirname, "..", "gui", "renderer", "index.html");
const screenshotDirectory = process.env.HSL_LIBRARY_SMOKE_DIR || null;

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
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, { cause: error });
  }
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
  return { initialScrollTop: setup.scrollTop, nearBottom, trace, view };
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
        error: semanticColor('--state-error'),
        success: semanticColor('--state-success'),
        warning: semanticColor('--state-warning'),
      },
    };
  })()`);
}

async function dotMetrics(window) {
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
        border: style.borderWidth,
        radius: style.borderRadius,
        shadow: style.boxShadow,
        after: getComputedStyle(element, '::after').content,
      };
    };
    return { connection: read(connection), pack: read(pack) };
  })()`);
}

async function iconRows(window) {
  const rows = [];
  for (const width of [340, 440, 600]) {
    rows.push(await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '${width}px');
      const grid = document.querySelector('.library-pack-grid--icons');
      const cards = [...grid.querySelectorAll('.pack-card')];
      const firstTop = cards[0].getBoundingClientRect().top;
      const firstRow = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) <= 1);
      return { width: ${width}, columns: firstRow.length, heights: firstRow.map((card) => card.getBoundingClientRect().height) };
    })()`));
  }
  return rows;
}

async function capture(window, filename) {
  if (!screenshotDirectory) return;
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(screenshotDirectory, filename), image.toPNG());
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

async function minimumWindowMetrics(window) {
  window.setSize(1200, 620);
  await delay(50);
  const metrics = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('.app-main').style.setProperty('--library-sidebar-width', '600px');
    const card = document.querySelector('.game-detail-card');
    card.style.minHeight = '900px';
    const scroll = document.querySelector('.game-scroll');
    scroll.scrollTop = scroll.scrollHeight;
    const cardRect = card.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    return {
      bottomGap: scrollRect.bottom - cardRect.bottom,
      detailWidth: scrollRect.width,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      gameScrollTop: scroll.scrollTop,
      libraryHeight: document.querySelector('.library-panel').getBoundingClientRect().height,
      rendererWidth: window.innerWidth,
      rendererHeight: window.innerHeight,
    };
  })()`);
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await capture(window, "detail-bottom-minimum-light.png");
  return { ...metrics, outerBounds: window.getBounds() };
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1200,
    minHeight: 620,
    show: Boolean(screenshotDirectory),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "library-browserwindow-fixture-preload.cjs"),
      sandbox: true,
    },
  });

  try {
    await window.loadURL(pathToFileURL(rendererDocument).href);
    await waitFor(window, "document.querySelectorAll('.pack-card').length === 40");
    await window.webContents.executeJavaScript("document.querySelector('[data-render-region=\"library-packs\"]').dataset.fixtureIdentity = 'library-packs-node'");
    const selections = [
      await stage("covers-middle", () => selectVisiblePack(window, { requestedTop: 600, view: "covers" })),
      await stage("covers-repeat", () => selectVisiblePack(window, { requestedTop: 900, view: "covers" })),
      await stage("icons-middle", () => selectVisiblePack(window, { requestedTop: 600, view: "icons" })),
      await stage("covers-bottom", () => selectVisiblePack(window, { nearBottom: true, view: "covers" })),
    ];
    const samePackDetail = await stage("same-pack", () => window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.game-detail-card');
      card.style.minHeight = '900px';
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
    const dots = await stage("dots", () => dotMetrics(window));
    const rows = await stage("rows", () => iconRows(window));
    await stage("captures", () => captureSmokeViews(window));
    const minimum = await stage("minimum", () => minimumWindowMetrics(window));
    process.stdout.write(`${JSON.stringify({ dots, minimum, rows, samePackDetail, selections, visuals: { dark: visualsDark, light: visualsLight } })}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.quit();
  }
});

app.on("window-all-closed", () => {});
