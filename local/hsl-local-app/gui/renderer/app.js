import { createStore, appendLog } from "./state.js";
import { COPY } from "./components/copy.js";
import { renderAppDialog } from "./components/app-dialog.js";
import { renderBusyOverlay } from "./components/busy-overlay.js";
import { renderDevTools } from "./components/dev-tools.js";
import { renderGamePanel } from "./components/game-panel.js";
import { renderHeader } from "./components/header.js";
import { renderIcon } from "./components/icon.js";
import { renderLibraryPanel } from "./components/library-panel.js";
import { renderLogPanel } from "./components/log-panel.js";
import { renderActivityDrawer } from "./components/queue-panel.js";
import { getLibraryCapabilities } from "./library-capabilities.js";
import { waitForMinimumVisibleDuration } from "./operation-feedback.js";

const root = document.getElementById("app");
const savedTheme = window.__HSL_INITIAL_THEME__ === "light" ? "light" : "dark";
const LIBRARY_SIDEBAR_MIN = 340;
const LIBRARY_SIDEBAR_MAX = 600;
const LIBRARY_SIDEBAR_DEFAULT = 440;
const LAUNCHER_VERSION = "v1.0.0";
const DETAIL_ASSET_PRELOAD_TIMEOUT_MS = 600;
const store = createStore({
  accountMenuOpen: false,
  activeDialog: null,
  activeOverlay: null,
  authError: null,
  authEmail: "",
  authFormOpen: false,
  busy: true,
  busyLabel: "Iniciando",
  connectionStatus: navigator.onLine === false ? "offline" : "connected",
  data: null,
  libraryFavoriteFilter: "all",
  libraryActivationInProgress: false,
  libraryFiltersOpen: false,
  libraryQuery: "",
  librarySeason: "all",
  librarySidebarWidth: LIBRARY_SIDEBAR_DEFAULT,
  librarySortBy: "weeks",
  librarySortDirection: "asc",
  libraryStatus: "all",
  libraryView: "covers",
  logs: [],
  noticeIds: [],
  pendingFavoriteKeys: {},
  pendingLibraryPackId: null,
  theme: savedTheme,
});

let accountMenuPointerStartedInside = false;
let libraryPreferencesPersistTimer = null;
let pendingLibraryPreferencesPatch = {};
let libraryPreferencesPersistSequence = 0;
let libraryPreferenceUserRevision = 0;
let hydratedLibraryPreferencesScopeKey = null;
let libraryPackSelectionSequence = 0;
let sidebarResize = null;
let metadataResizeObserver = null;
let metadataLayoutFrame = 0;
let favoriteTitleResizeObserver = null;
let favoriteTitleFrame = 0;
let currentDetailScrollKey = null;
let currentDialogType = null;
let busyRunSequence = 0;
const detailAssetPreloadCache = new Map();
const favoriteSyncByKey = new Map();
const unavailableDirectoryPrompts = new Set();

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function unavailableDirectoryKey(data) {
  const directory = data?.library?.directory;

  if (!directory?.configured || directory.available) {
    return null;
  }

  return `${directory.reason || "inaccessible"}:${directory.path || "unknown"}`;
}

function unavailableDirectoryDialogPatch(data) {
  const key = unavailableDirectoryKey(data);

  if (!key) {
    return {};
  }

  if (unavailableDirectoryPrompts.has(key)) {
    return {};
  }

  unavailableDirectoryPrompts.add(key);
  return {
    activeDialog: {
      directoryKey: key,
      type: "pack-directory-unavailable",
    },
  };
}

function libraryUnavailableStatePatch(data) {
  const capabilities = getLibraryCapabilities({ library: data?.library });

  return !capabilities.filtersEnabled
    ? { libraryFiltersOpen: false }
    : {};
}

function rejectedLibraryRootDialogPatch(response) {
  const result = response?.result;

  if (response?.ok || response?.canceled || !result?.classification) {
    return {};
  }

  return {
    activeDialog: {
      candidatePath: result.candidatePath || null,
      classification: result.classification,
      suggestedRootPath: result.suggestedRootPath || null,
      type: "library-root-rejected",
    },
  };
}

function resetUnavailableDirectoryPrompt(data) {
  const key = unavailableDirectoryKey(data);

  if (key) {
    unavailableDirectoryPrompts.delete(key);
  }
}

function neutralizeActivePackData(data) {
  if (!data) {
    return data;
  }

  return {
    ...data,
    activePack: null,
    bridge: {
      ...(data.bridge || {}),
      activeInstanceKey: null,
      activePackName: null,
      mode: "no-selection",
      packLoaded: false,
      packPath: null,
      packRoot: null,
    },
    game: null,
    selection: {
      ...(data.selection || {}),
      activeInstanceKey: null,
      activePackDir: null,
      source: "none",
    },
  };
}

function clampSidebarWidth(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return LIBRARY_SIDEBAR_DEFAULT;
  }

  return Math.min(LIBRARY_SIDEBAR_MAX, Math.max(LIBRARY_SIDEBAR_MIN, Math.round(numeric)));
}

function applyTheme(theme) {
  const normalizedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;
  document.documentElement.classList.remove("theme-bootstrap");
  localStorage.setItem("hsl-launcher-theme", normalizedTheme);
}

function readMainScrollState() {
  return {
    game: root.querySelector(".game-scroll")?.scrollTop || 0,
    library: root.querySelector(".library-section--packs")?.scrollTop || 0,
  };
}

function restoreMainScrollState(scrollState, { resetGame = false } = {}) {
  const gameScroll = root.querySelector(".game-scroll");
  const libraryScroll = root.querySelector(".library-section--packs");

  if (gameScroll) {
    gameScroll.scrollTop = resetGame ? 0 : scrollState.game;
  }

  if (libraryScroll) {
    libraryScroll.scrollTop = scrollState.library;
  }
}

function detailScrollKeyFromState(state) {
  const data = state.data || {};
  const activeInstanceKey = data.selection?.activeInstanceKey || null;
  const bridge = data.bridge || {};
  const game = data.game || {};
  const duplicatePaths = Array.isArray(game.duplicatePaths) ? game.duplicatePaths.join("|") : "";

  if (bridge.mode === "duplicate-group" || game.duplicateGroup) {
    return [
      "duplicate",
      game.duplicatePackId,
      game.packId,
      game.id,
      game.weekId,
      duplicatePaths,
      bridge.activePackName,
    ].filter(Boolean).join(":");
  }

  if (bridge.mode === "pack-issue") {
    return [
      "issue",
      bridge.packRoot,
      bridge.packPath,
      game.packRoot,
      game.packPath,
      game.packId,
      game.id,
      game.weekId,
    ].filter(Boolean).join(":");
  }

  return activeInstanceKey ? [
    "pack",
    activeInstanceKey,
    bridge.packRoot,
    bridge.packPath,
    game.packRoot,
    game.packPath,
    game.packId,
    game.id,
    game.rom,
    game.weekId,
  ].filter(Boolean).join(":") : null;
}

function metadataHasOverflow(grid) {
  return [...grid.querySelectorAll(".game-metadata-value")]
    .some((item) => item.scrollWidth > item.clientWidth + 1);
}

function applyGameMetadataLayout(grid) {
  grid.classList.remove(
    "game-metadata-grid--fallback",
    "game-metadata-grid--ellipsis",
  );

  if (!metadataHasOverflow(grid)) {
    return;
  }

  grid.classList.add("game-metadata-grid--fallback");

  if (!metadataHasOverflow(grid)) {
    return;
  }

  grid.classList.add("game-metadata-grid--ellipsis");
}

function syncGameMetadataLayout() {
  if (metadataResizeObserver) {
    metadataResizeObserver.disconnect();
  }

  const grids = [...root.querySelectorAll(".game-metadata-grid")];

  if (grids.length === 0) {
    metadataResizeObserver = null;
    return;
  }

  const schedule = () => {
    window.cancelAnimationFrame(metadataLayoutFrame);
    metadataLayoutFrame = window.requestAnimationFrame(() => {
      grids.forEach(applyGameMetadataLayout);
    });
  };

  metadataResizeObserver = new ResizeObserver(schedule);
  grids.forEach((grid) => metadataResizeObserver.observe(grid));
  schedule();
}

function normalizeFavoriteTitleLineRects(lineRects) {
  return lineRects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .reduce((lines, rect) => {
      const current = lines[lines.length - 1];
      if (current && Math.abs(current.top - rect.top) <= 2) {
        current.left = Math.min(current.left, rect.left);
        current.right = Math.max(current.right, rect.right);
        current.top = Math.min(current.top, rect.top);
        current.height = Math.max(current.height, rect.height);
        current.width = current.right - current.left;
        return lines;
      }

      lines.push({ ...rect });
      return lines;
    }, []);
}

function computeFavoriteStarPosition(lineRects, {
  containerWidth,
  gap = 9,
  minGap = 6,
  markHeight,
  markWidth,
}) {
  const lines = normalizeFavoriteTitleLineRects(lineRects);

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  const maxLineRight = Math.max(...lines.map((rect) => rect.right));
  const safeGap = maxLineRight + gap + markWidth <= containerWidth
    ? gap
    : minGap;

  if (maxLineRight + safeGap + markWidth > containerWidth) {
    return null;
  }

  const left = maxLineRight + safeGap;
  const top = Math.max(0, firstLine.top + (firstLine.height - markHeight) * 0.28);

  return {
    left: Math.round(left),
    top: Math.round(top),
  };
}

function placeFavoriteTitleMark(container) {
  const title = container.querySelector("h2");
  const mark = container.querySelector(".game-favorite-mark");
  const textNode = [...(title?.childNodes || [])]
    .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

  if (!title || !mark || !textNode) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(textNode);
  const containerRect = container.getBoundingClientRect();
  mark.hidden = false;
  const markRect = mark.getBoundingClientRect();
  const lineRects = [...range.getClientRects()].map((rect) => ({
    height: rect.height,
    left: rect.left - containerRect.left,
    right: rect.right - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
  }));
  const position = computeFavoriteStarPosition(lineRects, {
    containerWidth: containerRect.width,
    markHeight: markRect.height,
    markWidth: markRect.width,
  });

  if (!position) {
    mark.hidden = true;
    return;
  }

  mark.hidden = false;
  mark.style.setProperty("--favorite-mark-left", `${position.left}px`);
  mark.style.setProperty("--favorite-mark-top", `${position.top}px`);
}

function syncFavoriteTitleMarks() {
  if (favoriteTitleResizeObserver) {
    favoriteTitleResizeObserver.disconnect();
  }

  const containers = [...root.querySelectorAll(".game-title-main")];

  if (containers.length === 0) {
    favoriteTitleResizeObserver = null;
    return;
  }

  const schedule = () => {
    window.cancelAnimationFrame(favoriteTitleFrame);
    favoriteTitleFrame = window.requestAnimationFrame(() => {
      containers.forEach(placeFavoriteTitleMark);
    });
  };

  favoriteTitleResizeObserver = new ResizeObserver(schedule);
  containers.forEach((container) => {
    favoriteTitleResizeObserver.observe(container);
    const title = container.querySelector("h2");
    if (title) {
      favoriteTitleResizeObserver.observe(title);
    }
  });

  schedule();
  document.fonts?.ready?.then(schedule).catch(() => {});
}

function libraryPreferencesScopeKey(preferences = {}) {
  return `${preferences.scope || "global"}:${preferences.playerKey || ""}`;
}

function markLibraryPreferenceUserChange() {
  libraryPreferenceUserRevision += 1;
}

function libraryPreferencesStatePatch(data, current, allowHydration = true) {
  if (!allowHydration) {
    return {};
  }

  const preferences = data.library?.preferences || {};
  const scopeKey = libraryPreferencesScopeKey(preferences);

  if (hydratedLibraryPreferencesScopeKey === scopeKey) {
    return {};
  }

  hydratedLibraryPreferencesScopeKey = scopeKey;

  return {
    librarySidebarWidth: clampSidebarWidth(preferences.sidebarWidth || current.librarySidebarWidth),
    librarySortBy: preferences.librarySortBy || current.librarySortBy,
    librarySortDirection: preferences.librarySortDirection || current.librarySortDirection,
    libraryView: preferences.libraryView || current.libraryView,
  };
}

function currentLibraryPreferencesPatch(patch = {}) {
  const current = store.getState();

  return {
    librarySortBy: current.librarySortBy,
    librarySortDirection: current.librarySortDirection,
    libraryView: current.libraryView,
    sidebarWidth: current.librarySidebarWidth,
    ...patch,
  };
}

function preloadImageUrl(url, timeoutMs = DETAIL_ASSET_PRELOAD_TIMEOUT_MS) {
  if (!url) {
    return Promise.resolve(true);
  }

  if (detailAssetPreloadCache.has(url)) {
    return detailAssetPreloadCache.get(url);
  }

  const preload = new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(ok);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });

  detailAssetPreloadCache.set(url, preload);
  return preload;
}

function detailAssetUrlsFromGame(game = {}) {
  return [
    game.assets?.hero?.url || game.assets?.cover?.url,
    game.assets?.logo?.url || game.assets?.icon?.url,
  ].filter(Boolean);
}

function detailAssetUrlsFromLibraryPack(pack = {}) {
  return [
    pack.hero?.url || pack.cover?.url,
    pack.logo?.url || pack.icon?.url,
  ].filter(Boolean);
}

function preloadDetailAssetUrls(urls) {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];

  if (uniqueUrls.length === 0) {
    return Promise.resolve([]);
  }

  return Promise.all(uniqueUrls.map((url) => preloadImageUrl(url)));
}

function findLibraryPack(packId) {
  return store.getState().data?.library?.packs?.find((pack) => pack.id === packId) || null;
}

function withFavoritePatch(data, packKey, patch) {
  if (!data?.library?.packs || !packKey) {
    return data;
  }

  const selectedPack = data.library.packs.find((pack) => pack.favoriteKey === packKey);
  const activePackMatches = selectedPack && data.game && (
    data.game.instanceKey === selectedPack.instanceKey
  );

  return {
    ...data,
    game: activePackMatches
      ? { ...data.game, favorite: patch.favorite ?? data.game.favorite }
      : data.game,
    library: {
      ...data.library,
      packs: data.library.packs.map((pack) => (
        pack.favoriteKey === packKey
          ? { ...pack, ...patch }
          : pack
      )),
    },
  };
}

function renderOverlay(state) {
  if (!state.activeOverlay) {
    return "";
  }

  const isActivity = state.activeOverlay === "activity";

  return `
    <div class="modal-layer" data-overlay-backdrop>
      <aside class="drawer-layer" role="dialog" aria-modal="true" aria-label="${isActivity ? "Actividad local" : "Configuracion del launcher"}" data-drawer>
        <div class="drawer-header">
          <div>
            <p class="eyebrow">${isActivity ? "Cola local" : "Launcher"}</p>
            <h2>${isActivity ? "Actividad local" : "Configuracion"}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" title="Cerrar" aria-label="Cerrar">
            ${renderIcon("close", { className: "button-icon", size: "sm" })}
          </button>
        </div>
        <div class="drawer-body">
          ${isActivity ? renderActivityDrawer(state) : `
            <p class="advanced-shell__intro">Runtime MAME, directorio de packs, readiness, diagnóstico y herramientas legacy.</p>
            <div class="advanced-grid">
              ${renderDevTools(state)}
              ${renderLogPanel(state)}
            </div>
          `}
        </div>
      </aside>
    </div>
  `;
}

function renderStatusFooter() {
  return `
    <footer class="launcher-footer" aria-label="Estado del launcher">
      <span class="launcher-footer__status">
        ${renderIcon("check", { className: "footer-status-icon", size: "sm" })}
        <span>Launcher actualizado</span>
      </span>
      <span class="launcher-footer__version">${LAUNCHER_VERSION}</span>
    </footer>
  `;
}

function cleanAccountFormState() {
  return {
    authEmail: "",
    authError: null,
    authFormOpen: false,
  };
}

function closeAccountMenuState() {
  return {
    accountMenuOpen: false,
    ...cleanAccountFormState(),
  };
}

function openCleanAccountMenuState() {
  return {
    accountMenuOpen: true,
    ...cleanAccountFormState(),
  };
}

function openAccountFormState(email = "") {
  return {
    accountMenuOpen: true,
    authEmail: email,
    authError: null,
    authFormOpen: true,
  };
}

function render() {
  const state = store.getState();
  const scrollState = readMainScrollState();
  const nextDetailScrollKey = detailScrollKeyFromState(state);
  const resetGameScroll = Boolean(currentDetailScrollKey && nextDetailScrollKey && currentDetailScrollKey !== nextDetailScrollKey);
  applyTheme(state.theme);
  const sidebarWidth = clampSidebarWidth(state.librarySidebarWidth);

  root.innerHTML = `
    ${renderHeader(state)}
    <main class="app-main" style="--library-sidebar-width: ${sidebarWidth}px">
      <aside class="library-panel-region">
        <div class="library-scroll">
          ${renderLibraryPanel(state)}
        </div>
      </aside>
      <div class="library-resizer" data-sidebar-resizer role="separator" aria-orientation="vertical" aria-label="Ajustar anchura de biblioteca" tabindex="0"></div>
      <section class="game-panel-region">
        <div class="game-scroll">
          ${renderGamePanel(state)}
        </div>
      </section>
    </main>
    ${renderStatusFooter()}
    ${renderOverlay(state)}
    ${renderAppDialog(state)}
    ${renderBusyOverlay(state)}
  `;
  restoreMainScrollState(scrollState, { resetGame: resetGameScroll });
  currentDetailScrollKey = nextDetailScrollKey;
  syncGameMetadataLayout();
  syncFavoriteTitleMarks();
  syncDialogFocus(state);
}

function syncDialogFocus(state) {
  const dialogType = state.activeDialog?.type || null;

  if (!dialogType || dialogType === currentDialogType) {
    currentDialogType = dialogType;
    return;
  }

  currentDialogType = dialogType;
  window.requestAnimationFrame(() => {
    root.querySelector("[data-dialog-initial-focus]")?.focus();
  });
}

async function refreshState() {
  const startedWithLibraryPreferenceRevision = libraryPreferenceUserRevision;
  const data = await window.hslLauncher.getState();
  const current = store.getState();
  const allowLibraryPreferenceHydration = startedWithLibraryPreferenceRevision === libraryPreferenceUserRevision;
  const noticeLogs = (data.notices || [])
    .filter((notice) => !current.noticeIds.includes(notice.id))
    .map((notice) => ({
      details: notice.details || [],
      ok: notice.level !== "warning",
      summary: notice.summary,
      title: "Pack recordado",
    }));

  store.setState({
    ...unavailableDirectoryDialogPatch(data),
    ...libraryUnavailableStatePatch(data),
    busy: false,
    busyLabel: null,
    data,
    libraryFavoriteFilter: data.session?.hasSession ? current.libraryFavoriteFilter : "all",
    ...libraryPreferencesStatePatch(data, current, allowLibraryPreferenceHydration),
    logs: noticeLogs.reduce((logs, notice) => appendLog(logs, notice), current.logs),
    noticeIds: [
      ...current.noticeIds,
      ...(data.notices || []).map((notice) => notice.id),
    ],
  });
}

async function persistLibraryPreferences(patch) {
  const requestId = ++libraryPreferencesPersistSequence;

  try {
    await window.hslLauncher.setLibraryPreferences(currentLibraryPreferencesPatch(patch));
  } catch (error) {
    if (requestId !== libraryPreferencesPersistSequence) {
      return;
    }

    store.setState({
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudieron guardar las preferencias de biblioteca.",
        title: "Biblioteca",
      }),
    });
  }
}

function persistLibraryPreferencesSoon(patch) {
  pendingLibraryPreferencesPatch = {
    ...pendingLibraryPreferencesPatch,
    ...patch,
  };

  if (libraryPreferencesPersistTimer) {
    window.clearTimeout(libraryPreferencesPersistTimer);
  }

  libraryPreferencesPersistTimer = window.setTimeout(() => {
    const nextPatch = pendingLibraryPreferencesPatch;
    pendingLibraryPreferencesPatch = {};
    libraryPreferencesPersistTimer = null;
    persistLibraryPreferences(nextPatch);
  }, 250);
}

async function toggleLibraryFavorite(packKey) {
  const current = store.getState();
  const pack = current.data?.library?.packs?.find((item) => item.favoriteKey === packKey);

  if (!packKey || !pack || pack.favoriteDisabled || pack.duplicatePackId) {
    return;
  }

  const previousFavorite = Boolean(pack.favorite);
  const nextFavorite = !Boolean(pack.favorite);
  const existingSync = favoriteSyncByKey.get(packKey) || {
    desiredFavorite: previousFavorite,
    inFlight: false,
    rollbackFavorite: previousFavorite,
    sequence: 0,
  };
  const nextSync = {
    ...existingSync,
    desiredFavorite: nextFavorite,
    rollbackFavorite: existingSync.inFlight ? existingSync.rollbackFavorite : previousFavorite,
    sequence: existingSync.sequence + 1,
  };

  favoriteSyncByKey.set(packKey, nextSync);

  store.setState({
    data: withFavoritePatch(current.data, packKey, {
      favorite: nextFavorite,
      favoritePending: true,
    }),
    pendingFavoriteKeys: {
      ...current.pendingFavoriteKeys,
      [packKey]: nextSync.sequence,
    },
  });

  if (existingSync.inFlight) {
    return;
  }

  syncLibraryFavorite(packKey);
}

async function syncLibraryFavorite(packKey) {
  while (favoriteSyncByKey.has(packKey)) {
    const sync = favoriteSyncByKey.get(packKey);
    const currentPack = store.getState().data?.library?.packs?.find((item) => item.favoriteKey === packKey);

    if (!currentPack) {
      favoriteSyncByKey.delete(packKey);
      const latestPending = { ...store.getState().pendingFavoriteKeys };
      delete latestPending[packKey];
      store.setState({ pendingFavoriteKeys: latestPending });
      return;
    }

    const requestSequence = sync.sequence;
    const favoriteBeforeRequest = Boolean(sync.rollbackFavorite);
    favoriteSyncByKey.set(packKey, {
      ...sync,
      inFlight: true,
    });

    try {
      const response = await window.hslLauncher.toggleLibraryFavorite(packKey);

      if (response.ok === false) {
        throw new Error(response.summary || "No se pudo actualizar el favorito.");
      }

      const latestSync = favoriteSyncByKey.get(packKey);

      if (response.state) {
        store.setState({
          data: response.state,
        });
      } else {
        store.setState({
          data: withFavoritePatch(store.getState().data, packKey, {
            favorite: sync.desiredFavorite,
          }),
        });
      }

      const afterResponseSync = favoriteSyncByKey.get(packKey) || latestSync;
      const latestPack = store.getState().data?.library?.packs?.find((item) => item.favoriteKey === packKey);

      if (!afterResponseSync || !latestPack) {
        continue;
      }

      favoriteSyncByKey.set(packKey, {
        ...afterResponseSync,
        inFlight: false,
        rollbackFavorite: Boolean(latestPack.favorite),
      });

      if (Boolean(latestPack.favorite) !== afterResponseSync.desiredFavorite) {
        store.setState({
          data: withFavoritePatch(store.getState().data, packKey, {
            favorite: afterResponseSync.desiredFavorite,
            favoritePending: true,
          }),
        });
        continue;
      }
    } catch (error) {
      const latestSync = favoriteSyncByKey.get(packKey);

      if (latestSync && latestSync.sequence !== requestSequence) {
        favoriteSyncByKey.set(packKey, {
          ...latestSync,
          inFlight: false,
        });
        continue;
      }

      favoriteSyncByKey.delete(packKey);
      const latestPending = { ...store.getState().pendingFavoriteKeys };
      delete latestPending[packKey];

      store.setState({
        data: withFavoritePatch(store.getState().data, packKey, {
          favorite: favoriteBeforeRequest,
          favoritePending: false,
        }),
        logs: appendLog(store.getState().logs, {
          details: [error.message || String(error)],
          ok: false,
          summary: "No se pudo actualizar el favorito.",
          title: "Biblioteca",
        }),
        pendingFavoriteKeys: latestPending,
      });
      return;
    }

    const latestSync = favoriteSyncByKey.get(packKey);
    const latestPack = store.getState().data?.library?.packs?.find((item) => item.favoriteKey === packKey);

    if (!latestSync || !latestPack || Boolean(latestPack.favorite) === latestSync.desiredFavorite) {
      favoriteSyncByKey.delete(packKey);
      const latestPending = { ...store.getState().pendingFavoriteKeys };
      delete latestPending[packKey];
      store.setState({
        data: withFavoritePatch(store.getState().data, packKey, { favoritePending: false }),
        pendingFavoriteKeys: latestPending,
      });
      return;
    }
  }
}

function updateSidebarWidth(width, save = false) {
  const nextWidth = clampSidebarWidth(width);

  markLibraryPreferenceUserChange();
  store.setState({ librarySidebarWidth: nextWidth });

  if (save) {
    persistLibraryPreferences({ sidebarWidth: nextWidth });
  }
}

function resultToLog(title, response) {
  const lines = response.lines || [];
  const extra = response.report
    ? [
        `Errores: ${response.report.errorCount}`,
        `Advertencias: ${response.report.warningCount}`,
        ...response.report.recommendations.slice(0, 3),
      ]
    : [];
  const ok = response.ok !== false && response.exitCode !== 1;
  const details = [...lines, ...extra];
  const friendly = {
    login: ok
      ? "Login correcto."
      : "No he podido iniciar sesión. Revisa email y contraseña.",
    diagnose: ok
      ? "Diagnóstico completado. El launcher puede seguir usándose."
      : "El diagnóstico encontró algo que conviene revisar.",
    logout: ok
      ? "Sesión local cerrada. Tus puntuaciones guardadas no se han borrado."
      : "No se pudo cerrar la sesión local.",
    "open-pack": response.summary || (ok
      ? "Pack cargado. Cambiar de pack no borra puntuaciones locales."
      : "No se pudo abrir el pack seleccionado."),
    "open-membership-url": response.summary || (ok
      ? "Web abierta en el navegador."
      : "No se pudo abrir la web."),
    "choose-pack-directory": response.summary || "Directorio de packs actualizado.",
    "choose-shared-mame-runtime": response.summary || "Runtime MAME actualizado.",
    "check-membership": response.summary || "Comprobacion de temporada actualizada.",
    "import-pack": response.summary || (ok
      ? "Pack importado."
      : "No se pudo completar la importacion. No se ha instalado nada."),
    "open-pack-directory": response.summary || "Directorio de packs abierto.",
    "open-manual": response.summary || (ok ? "Manual abierto." : "Este pack todavia no incluye manual local."),
    "open-ranking": response.summary || (ok ? "Ranking abierto en la web." : "Ranking integrado pendiente."),
    "open-shared-mame-runtime": response.summary || "Carpeta MAME abierta.",
    "remove-known-account": response.summary || (ok
      ? "Cuenta quitada de este dispositivo. No se han borrado puntuaciones locales."
      : "No se pudo quitar la cuenta recordada."),
    "use-library-pack": response.summary || (ok
      ? "Pack activado desde biblioteca."
      : "No se pudo activar el pack desde biblioteca."),
    "play-competition": ok
      ? "MAME se cerro correctamente. La cola local se ha actualizado."
      : "MAME termino con aviso. Si jugaste una partida, revisa la cola local.",
    practice: ok
      ? "Práctica cerrada. No se activó el plugin de puntuación desde el launcher."
      : "La práctica terminó con aviso.",
    refresh: "Estado local actualizado.",
    "rescan-pack-directory": response.summary || "Biblioteca reescaneada.",
    "submit-all": ok
      ? "Subida finalizada. Si había puntuaciones válidas, se movieron a enviadas."
      : "No se pudo completar la subida. Tus puntuaciones siguen guardadas localmente.",
    "restore-failed": ok
      ? "Puntuación restaurada a pendientes. Puedes reintentar cuando el problema esté corregido."
      : "No se pudo restaurar la puntuación.",
    "submit-all-with-failed": "Hay puntuaciones que requieren atención. No se han perdido y puedes restaurarlas a pendientes.",
    "sync-plugin": ok
      ? "Plugin sincronizado con el pack de desarrollo."
      : "No se pudo sincronizar el plugin de desarrollo.",
    "switch-account": response.summary || (ok
      ? "Cuenta cambiada. La cola visible corresponde a esta cuenta y pack."
      : "No se pudo cambiar de cuenta."),
    "switch-account-login-required": response.summary || "Inicia sesión de nuevo para esta cuenta.",
  };

  return {
    details,
    ok,
    summary: friendly[response.action] || (ok ? "Accion completada." : "La accion necesita revision."),
    title,
  };
}

async function runAction(action, busyLabel, title, fn, options = {}) {
  if (store.getState().busy) return;

  const runId = ++busyRunSequence;
  const busyStartedAt = Date.now();
  let phaseTimer = null;
  store.setState({
    ...closeAccountMenuState(),
    busy: true,
    busyLabel,
    ...(options.neutralizeActivePack
      ? { data: neutralizeActivePackData(store.getState().data) }
      : {}),
  });

  if (options.runningLabel) {
    phaseTimer = window.setTimeout(() => {
      const current = store.getState();

      if (runId === busyRunSequence && current.busy) {
        store.setState({ busyLabel: options.runningLabel });
      }
    }, options.runningDelayMs || 1200);
  }

  try {
    const response = await fn();
    window.clearTimeout(phaseTimer);

    if (options.closingLabel) {
      store.setState({ busyLabel: options.closingLabel });
      await delay(options.closingDelayMs || 450);
    }

    await waitForMinimumVisibleDuration({
      minVisibleMs: options.minVisibleMs,
      startedAt: busyStartedAt,
    });

    if (runId !== busyRunSequence) return;

    const statePatch = {
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, resultToLog(title, response)),
    };

    if (response.state) {
      statePatch.data = response.state;
      Object.assign(statePatch, libraryUnavailableStatePatch(response.state));

      if (options.promptForUnavailableDirectory) {
        Object.assign(statePatch, unavailableDirectoryDialogPatch(response.state));
      }
    }

    if (options.promptForRejectedLibraryRoot) {
      Object.assign(statePatch, rejectedLibraryRootDialogPatch(response));
    }

    store.setState(statePatch);
  } catch (error) {
    window.clearTimeout(phaseTimer);
    await waitForMinimumVisibleDuration({
      minVisibleMs: options.minVisibleMs,
      startedAt: busyStartedAt,
    });

    if (runId !== busyRunSequence) return;

    store.setState({
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "La acción no pudo completarse. Si había puntuaciones, siguen en la cola local.",
        title,
      }),
    });
  }
}

async function submitLogin(form) {
  if (store.getState().busy) return;

  const fields = new FormData(form);
  const email = String(fields.get("email") || "").trim();
  const password = String(fields.get("password") || "");

  store.setState({ authError: null, busy: true, busyLabel: "Conectando" });

  try {
    const response = await window.hslLauncher.login(email, password);

    store.setState({
      authError: response.ok ? null : response.summary || "No he podido iniciar sesión.",
      authEmail: response.ok ? "" : email,
      authFormOpen: !response.ok,
      accountMenuOpen: !response.ok,
      busy: false,
      busyLabel: null,
      data: response.state || store.getState().data,
      logs: appendLog(store.getState().logs, resultToLog("Iniciar sesión", response)),
    });
  } catch {
    store.setState({
      authError: "No he podido iniciar sesión. Revisa email y contraseña.",
      accountMenuOpen: true,
      authFormOpen: true,
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [],
        ok: false,
        summary: "No he podido iniciar sesión. Revisa email y contraseña.",
        title: "Iniciar sesión",
      }),
    });
  }
}

async function switchAccount(button) {
  if (store.getState().busy) return;

  const email = button.dataset.email || "";
  const userId = button.dataset.userId;

  if (!userId) {
    store.setState(openAccountFormState(email));
    return;
  }

  store.setState({ busy: true, busyLabel: "Cambiando cuenta" });

  try {
    const response = await window.hslLauncher.switchAccount(userId);
    const nextState = {
      busy: false,
      busyLabel: null,
      data: response.state || store.getState().data,
      logs: appendLog(store.getState().logs, resultToLog("Cambiar cuenta", response)),
    };

    if (response.requiresLogin) {
      nextState.accountMenuOpen = true;
      nextState.authEmail = response.email || email;
      nextState.authError = response.summary || "Inicia sesión de nuevo para esta cuenta.";
      nextState.authFormOpen = true;
    } else {
      nextState.accountMenuOpen = false;
      nextState.authEmail = "";
      nextState.authError = null;
      nextState.authFormOpen = false;
    }

    store.setState(nextState);
  } catch (error) {
    store.setState({
      accountMenuOpen: true,
      authEmail: email,
      authError: "No se pudo cambiar de cuenta. Inicia sesión de nuevo.",
      authFormOpen: true,
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudo cambiar de cuenta.",
        title: "Cambiar cuenta",
      }),
    });
  }
}

async function activateLibraryPackWithPreload(packId) {
  const safePackId = String(packId || "");

  if (!safePackId) return;

  const requestId = ++libraryPackSelectionSequence;
  const optimisticPack = findLibraryPack(safePackId);
  const optimisticPreload = preloadDetailAssetUrls(detailAssetUrlsFromLibraryPack(optimisticPack));

  store.setState({
    ...closeAccountMenuState(),
    busy: true,
    busyLabel: "Activando pack",
    libraryActivationInProgress: true,
    pendingLibraryPackId: safePackId,
  });

  try {
    const response = await window.hslLauncher.useLibraryPack(safePackId);

    if (requestId !== libraryPackSelectionSequence) {
      return;
    }

    await optimisticPreload;

    if (response.state) {
      await preloadDetailAssetUrls(detailAssetUrlsFromGame(response.state.game));
    }

    if (requestId !== libraryPackSelectionSequence) {
      return;
    }

    store.setState({
      busy: false,
      busyLabel: null,
      data: response.state || store.getState().data,
      libraryActivationInProgress: false,
      logs: appendLog(store.getState().logs, resultToLog("Usar pack de biblioteca", response)),
      pendingLibraryPackId: null,
    });
  } catch (error) {
    if (requestId !== libraryPackSelectionSequence) {
      return;
    }

    store.setState({
      busy: false,
      busyLabel: null,
      libraryActivationInProgress: false,
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudo activar el pack desde biblioteca.",
        title: "Usar pack de biblioteca",
      }),
      pendingLibraryPackId: null,
    });
  }
}

function bindActions() {
  root.addEventListener("error", (event) => {
    const hero = event.target instanceof Element ? event.target.closest("[data-hsl-fallback-hero]") : null;

    if (hero) {
      hero.hidden = true;
    }
  }, true);

  root.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-library-search]") : null;
    if (!input) return;

    const cursor = input.selectionStart;
    store.setState({ libraryQuery: input.value });
    const nextInput = root.querySelector("[data-library-search]");

    if (nextInput instanceof HTMLInputElement) {
      nextInput.focus();

      if (Number.isInteger(cursor)) {
        nextInput.setSelectionRange(cursor, cursor);
      }
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    if (target.matches("[data-library-season]")) {
      store.setState({ librarySeason: target.value });
    }

    if (target.matches("[data-library-sort-by]")) {
      const librarySortBy = target.value;
      markLibraryPreferenceUserChange();
      store.setState({ librarySortBy });
      persistLibraryPreferencesSoon({ librarySortBy });
    }

  });

  root.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    accountMenuPointerStartedInside = Boolean(
      target?.closest("[data-account-menu]") || target?.closest("[data-action='toggle-account-menu']"),
    );
    const resizer = target?.closest("[data-sidebar-resizer]");

    if (!resizer) return;

    event.preventDefault();
    sidebarResize = {
      startX: event.clientX,
      startWidth: clampSidebarWidth(store.getState().librarySidebarWidth),
    };
    document.body.classList.add("is-resizing-library");
  });

  window.addEventListener("pointermove", (event) => {
    if (!sidebarResize) return;

    updateSidebarWidth(sidebarResize.startWidth + event.clientX - sidebarResize.startX);
  });

  window.addEventListener("pointerup", () => {
    if (!sidebarResize) return;

    sidebarResize = null;
    document.body.classList.remove("is-resizing-library");
    persistLibraryPreferences({ sidebarWidth: store.getState().librarySidebarWidth });
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const resizer = target?.closest("[data-sidebar-resizer]");

    if (resizer && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home")) {
      event.preventDefault();
      const current = store.getState().librarySidebarWidth;
      const delta = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : LIBRARY_SIDEBAR_DEFAULT - current;
      updateSidebarWidth(current + delta, true);
      return;
    }

    const card = target?.closest("[role='button'][data-action='use-library-pack']");

    if (card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      card.click();
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target instanceof Element ? event.target.closest("[data-auth-form]") : null;
    if (!form) return;

    event.preventDefault();
    submitLogin(form);
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const current = store.getState();
    const pointerStartedInsideAccountMenu = accountMenuPointerStartedInside;
    accountMenuPointerStartedInside = false;

    if (target?.matches("[data-dialog-backdrop]")) {
      store.setState({ activeDialog: null });
      return;
    }

    if (target?.matches("[data-overlay-backdrop]")) {
      store.setState({ activeOverlay: null });
      return;
    }

    if (
      current.accountMenuOpen &&
      target &&
      !target.closest("[data-account-menu]") &&
      !target.closest("[data-action='toggle-account-menu']")
    ) {
      if (!pointerStartedInsideAccountMenu) {
        store.setState(closeAccountMenuState());
      }
    }

    const button = target?.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "toggle-theme") {
      store.setState({ theme: store.getState().theme === "dark" ? "light" : "dark" });
    }

    if (action === "show-settings") {
      store.setState({ ...closeAccountMenuState(), activeOverlay: "advanced" });
    }

    if (action === "toggle-account-menu") {
      store.setState(store.getState().accountMenuOpen ? closeAccountMenuState() : openCleanAccountMenuState());
    }

    if (action === "show-activity-details") {
      if (!store.getState().data?.session?.hasSession) {
        return;
      }
      store.setState({ ...closeAccountMenuState(), activeOverlay: "activity" });
    }

    if (action === "toggle-library-sort-direction") {
      const librarySortDirection = button.dataset.direction === "desc" ? "desc" : "asc";
      markLibraryPreferenceUserChange();
      store.setState({ librarySortDirection });
      persistLibraryPreferencesSoon({ librarySortDirection });
    }

    if (action === "toggle-library-favorite-filter") {
      if (button.disabled || !store.getState().data?.session?.hasSession) {
        return;
      }

      store.setState({ libraryFavoriteFilter: button.dataset.filter === "favorites" ? "favorites" : "all" });
    }

    if (action === "close-overlay") {
      store.setState({ activeOverlay: null });
    }

    if (action === "close-dialog") {
      store.setState({ activeDialog: null });
    }

    if (action === "set-library-view") {
      if (button.disabled || !getLibraryCapabilities(store.getState()).viewsEnabled) {
        return;
      }

      const libraryView = button.dataset.view || "covers";
      markLibraryPreferenceUserChange();
      store.setState({ libraryView });
      persistLibraryPreferencesSoon({ libraryView });
    }

    if (action === "toggle-library-filters") {
      if (button.disabled || !getLibraryCapabilities(store.getState()).filtersEnabled) {
        return;
      }

      store.setState({ libraryFiltersOpen: !store.getState().libraryFiltersOpen });
    }

    if (action === "toggle-library-favorite") {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled || !store.getState().data?.session?.hasSession) {
        return;
      }
      toggleLibraryFavorite(button.dataset.packKey || "");
    }

    if (action === "show-login") {
      store.setState(openAccountFormState());
    }

    if (action === "add-account") {
      store.setState(openAccountFormState());
    }

    if (action === "switch-account") {
      switchAccount(button);
    }

    if (action === "cancel-login") {
      store.setState(closeAccountMenuState());
    }

    if (action === "refresh") {
      runAction("refresh", "Actualizando", COPY.actions.refresh, async () => {
        const data = await window.hslLauncher.getState();
        return {
          action: "refresh",
          lines: ["Estado local actualizado."],
          ok: true,
          state: data,
        };
      });
    }

    if (action === "open-pack") {
      runAction(action, "Abriendo pack", COPY.actions.openPack, () => window.hslLauncher.openPack());
    }

    if (action === "choose-pack-directory") {
      runAction(action, "Eligiendo directorio", "Elegir directorio", () => window.hslLauncher.choosePackDirectory(), {
        promptForRejectedLibraryRoot: true,
      });
    }

    if (action === "choose-unavailable-pack-directory") {
      store.setState({ activeDialog: null });
      runAction("choose-pack-directory", "Eligiendo directorio", "Elegir directorio", () => window.hslLauncher.choosePackDirectory(), {
        promptForRejectedLibraryRoot: true,
      });
    }

    if (action === "choose-other-library-root") {
      store.setState({ activeDialog: null });
      runAction("choose-pack-directory", "Eligiendo directorio", "Elegir directorio", () => window.hslLauncher.choosePackDirectory(), {
        promptForRejectedLibraryRoot: true,
      });
    }

    if (action === "use-suggested-library-root") {
      const suggestedRootPath = current.activeDialog?.suggestedRootPath;

      if (suggestedRootPath) {
        store.setState({ activeDialog: null });
        runAction("choose-pack-directory", "Actualizando biblioteca", "Usar carpeta superior", () => (
          window.hslLauncher.useSuggestedPackDirectory(suggestedRootPath)
        ), {
          promptForRejectedLibraryRoot: true,
        });
      }
    }

    if (action === "import-pack") {
      store.setState({ activeDialog: { type: "import-pack" } });
    }

    if (action === "import-pack-zip") {
      store.setState({ activeDialog: null });
      runAction("import-pack", "Eligiendo ZIP", "Importar pack", () => window.hslLauncher.importPackZip());
    }

    if (action === "import-pack-folder") {
      store.setState({ activeDialog: null });
      runAction("import-pack", "Eligiendo carpeta", "Importar pack", () => window.hslLauncher.importPackFolder());
    }

    if (action === "choose-shared-mame-runtime") {
      runAction(action, "Eligiendo MAME", "Elegir mame.exe", () => window.hslLauncher.chooseSharedMameRuntime());
    }

    if (action === "open-pack-directory") {
      runAction(action, "Abriendo directorio", "Abrir directorio", () => window.hslLauncher.openPackDirectory());
    }

    if (action === "open-shared-mame-runtime") {
      runAction(action, "Abriendo MAME", "Abrir carpeta MAME", () => window.hslLauncher.openSharedMameRuntime());
    }

    if (action === "rescan-pack-directory") {
      resetUnavailableDirectoryPrompt(store.getState().data);
      runAction(action, "Reescaneando", "Reescanear", () => window.hslLauncher.rescanPackDirectory(), {
        minVisibleMs: 600,
        neutralizeActivePack: true,
        promptForUnavailableDirectory: true,
      });
    }

    if (action === "use-library-pack") {
      const packId = button.dataset.packId;
      activateLibraryPackWithPreload(packId);
    }

    if (action === "open-membership-url") {
      runAction(action, "Abriendo web", "Abrir temporada en la web", () => window.hslLauncher.openMembershipUrl());
    }

    if (action === "open-manual") {
      runAction(action, "Abriendo manual", "Ver manual", () => window.hslLauncher.openManual());
    }

    if (action === "open-ranking") {
      runAction(action, "Abriendo ranking", "Ver ranking", () => window.hslLauncher.openRanking());
    }

    if (action === "check-membership") {
      runAction(action, "Comprobando temporada", "Comprobar de nuevo", () => window.hslLauncher.checkMembership());
    }

    if (action === "diagnose") {
      runAction(action, "Diagnosticando", COPY.actions.diagnose, () => window.hslLauncher.diagnose());
    }

    if (action === "play") {
      runAction(action, "Abriendo competición", COPY.actions.play, () => window.hslLauncher.playCompetition(), {
        closingLabel: "Cerrando competición",
        runningLabel: "Competición en curso",
      });
    }

    if (action === "practice") {
      runAction(action, "Abriendo práctica", COPY.actions.practice, () => window.hslLauncher.practice(), {
        closingLabel: "Cerrando práctica",
        runningLabel: "Práctica en curso",
      });
    }

    if (action === "submit") {
      runAction(action, "Subiendo puntuaciones", COPY.actions.submit, () => window.hslLauncher.submitAll());
    }

    if (action === "restore-failed") {
      const filename = button.dataset.filename;
      runAction(action, "Restaurando", "Restaurar a pendientes", () => window.hslLauncher.restoreFailed(filename));
    }

    if (action === "remove-known-account") {
      const userId = button.dataset.userId;
      runAction(action, "Quitando cuenta", "Quitar cuenta", () => window.hslLauncher.removeKnownAccount(userId));
    }

    if (action === "sync-plugin") {
      runAction(action, "Sincronizando plugin", COPY.actions.syncPlugin, () => window.hslLauncher.syncPlugin());
    }

    if (action === "logout") {
      runAction(action, "Cerrando sesión", COPY.actions.logout, () => window.hslLauncher.logout());
    }
  });
}

store.subscribe(render);
render();
bindActions();
window.addEventListener("keydown", (event) => {
  if (event.key === "D" && event.ctrlKey && event.shiftKey) {
    event.preventDefault();
    store.setState({ ...closeAccountMenuState(), activeOverlay: "advanced" });
    return;
  }

  if (event.key !== "Escape") return;

  const state = store.getState();

  if (state.activeDialog || state.activeOverlay || state.accountMenuOpen) {
    store.setState({ ...closeAccountMenuState(), activeDialog: null, activeOverlay: null });
  }
});
window.addEventListener("offline", () => store.setState({ connectionStatus: "offline" }));
window.addEventListener("online", () => {
  store.setState({ connectionStatus: "reconnecting" });
  window.setTimeout(() => store.setState({ connectionStatus: "connected" }), 800);
});
window.hslLauncher.onBusyPhase?.((phase) => {
  const label = String(phase?.label || "").trim();

  if (label && store.getState().busy) {
    store.setState({ busyLabel: label });
  }
});
refreshState().catch((error) => {
  store.setState({
    busy: false,
    busyLabel: null,
    logs: appendLog(store.getState().logs, {
      details: [error.message || String(error)],
      ok: false,
      summary: "No se pudo leer el estado local inicial.",
      title: "Carga inicial",
    }),
  });
});
