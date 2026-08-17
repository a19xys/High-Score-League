import { createStore, appendLog } from "./state.js";
import { COPY } from "./components/copy.js";
import { renderAppDialog } from "./components/app-dialog.js";
import { renderBusyOverlay } from "./components/busy-overlay.js";
import { renderDevTools } from "./components/dev-tools.js";
import {
  renderGameActionsRegion,
  renderGameActivityRegion,
  renderGameHeroIndicatorsRegion,
  renderGameIdentityRegion,
  renderGamePanel,
  renderGameVisualRegion,
  shouldRenderLibraryBrandFallback,
} from "./components/game-panel.js";
import {
  renderAccountControl,
  renderConnectionControl,
  renderHeader,
  renderThemeControl,
} from "./components/header.js";
import { markIconLoaded, markIconMissing, renderIcon } from "./components/icon.js";
import {
  deriveLibraryPacksRenderModel,
  libraryPacksTopologyKey,
  renderLibraryControls,
  renderLibraryHeading,
  renderLibraryPacks,
  renderLibraryPanel,
} from "./components/library-panel.js";
import { renderLogPanel } from "./components/log-panel.js";
import { renderActivityDrawer } from "./components/queue-panel.js";
import { getLibraryCapabilities } from "./library-capabilities.js";
import { deriveRemoteAvailability } from "./remote-availability.js";
import { getRankingActionState } from "./ranking-state.js";
import { createLauncherStateGate } from "./launcher-state-gate.js";
import {
  clampLibrarySidebarWidth,
  LIBRARY_SIDEBAR_DEFAULT,
  LIBRARY_SIDEBAR_MAX,
  LIBRARY_SIDEBAR_MIN,
} from "./library-geometry.js";
import { syncLibraryPackRegionState } from "./library-card-sync.js";
import { applyLibraryPacksRenderPlan } from "./library-render-plan.js";
import { resolveLibraryArtPresentation } from "./library-art-presentation.js";
import { createRegionRenderer, preservedScrollElements } from "./region-renderer.js";
import {
  cancelActiveOperationFeedback,
  runWithOperationFeedback,
} from "./operation-feedback.js";
import { assetIdentityMatches, createAssetPreloader } from "./asset-preloader.js";
import { classifyStartupSnapshot, createStartupReadiness } from "./startup-readiness.js";
import {
  deriveLiveAnnouncement,
  shouldSurfaceAccountSwitchResult,
} from "./product-presentation.js";
import { createEphemeralLoginDraft } from "./login-draft.js";

const root = document.getElementById("app");
const savedTheme = window.__HSL_INITIAL_THEME__ === "light" ? "light" : "dark";
const LAUNCHER_VERSION = `v${window.hslLauncher?.productVersion || "0.0.0"}`;
const DETAIL_ASSET_PRELOAD_TIMEOUT_MS = 1_200;
const store = createStore({
  accountMenuOpen: false,
  activeDialog: null,
  activeOverlay: null,
  authError: null,
  authEmail: "",
  authFormOpen: false,
  busy: false,
  busyLabel: null,
  connectivity: null,
  data: null,
  launcherStateDiagnostics: { highestRevision: null, legacySnapshotsIgnored: 0, staleSnapshotsIgnored: 0 },
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
  initialLoadError: null,
  logs: [],
  noticeIds: [],
  operationFeedbackMode: "overlay",
  pendingFavoriteKeys: {},
  pendingLibraryPackId: null,
  rankingCapabilities: { entries: {}, generation: 0, inFlight: false },
  rankingOpening: false,
  startup: {
    phases: {
      criticalAssets: "pending",
      library: "pending",
      localState: "pending",
      selection: "pending",
      shell: "pending",
      theme: "ready",
    },
    status: "bootstrap",
    visible: true,
  },
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
let currentDetailScrollKey = null;
let currentDialogType = null;
let currentOverlayType = null;
let currentGameStructureKey = null;
let currentLibraryStructureKey = null;
let currentLibraryPacksTopologyKey = null;
let rendererMounted = false;
const loginDraft = createEphemeralLoginDraft();
let loginDraftOpen = false;
let pendingLoginDraftSeed = null;
let lastRenderedState = null;
let dialogReturnFocus = null;
let dialogReturnFocusIdentity = null;
let overlayReturnFocus = null;
let busyRunSequence = 0;
let activeBusyPhaseTimer = null;
let activeRankingFeedback = null;
let detailAssetGeneration = 0;
let detailAssetIdentity = null;
let startupAssetSequence = 0;
let startupCompletionLogged = false;
let themeToggleQueue = Promise.resolve();
const assetPreloader = createAssetPreloader({ timeoutMs: DETAIL_ASSET_PRELOAD_TIMEOUT_MS });
const favoriteSyncByKey = new Map();
const unavailableDirectoryPrompts = new Set();
const launcherStateGate = createLauncherStateGate();
const startupReadiness = createStartupReadiness({
  onChange(startup) {
    const current = store.getState();
    const patch = { startup };
    if (!startup.visible && startup.status === "degraded" && !current.data) {
      patch.initialLoadError = startup.reason === "startup-timeout"
        ? "El estado local está tardando más de lo esperado. Puedes seguir usando el launcher mientras termina."
        : current.initialLoadError;
    }
    if (!startup.visible && !startupCompletionLogged) {
      startupCompletionLogged = true;
      window.hslLauncher.reportStartupMilestone?.({
        name: startup.status === "degraded" ? "startup-degraded" : "startup-ready",
        status: startup.status,
      });
      window.hslLauncher.reportStartupMilestone?.({ name: "interactive", status: startup.status });
    }
    store.setState(patch);
  },
});

function detailAssetIdentityFromSnapshot(snapshot = {}) {
  const game = snapshot.game || {};
  const selection = snapshot.selection?.activeInstanceKey || game.instanceKey || "none";
  return [
    selection,
    game.assets?.hero?.url || game.assets?.cover?.url || "",
    game.assets?.logo?.url || game.assets?.icon?.url || "",
  ].join("|");
}

function withDetailAssetAuthority(snapshot) {
  if (!snapshot) return snapshot;
  const identity = detailAssetIdentityFromSnapshot(snapshot);
  if (identity !== detailAssetIdentity) {
    detailAssetIdentity = identity;
    detailAssetGeneration += 1;
  }
  if (!snapshot.game) return snapshot;
  return {
    ...snapshot,
    game: {
      ...snapshot.game,
      visualAssetGeneration: detailAssetGeneration,
    },
  };
}

function evaluateLauncherSnapshot(snapshot, options = {}) {
  if (!snapshot) return { accepted: false, patch: {} };
  const decision = launcherStateGate.accept(snapshot);
  const nextData = decision.accepted ? withDetailAssetAuthority(snapshot) : null;
  const current = store.getState();
  return {
    accepted: decision.accepted,
    patch: {
      ...(decision.accepted ? {
        data: nextData,
        ...invalidateStaleRankingFeedback(nextData),
        ...libraryPreferencesStatePatch(nextData, current, options.allowPreferenceHydration !== false),
        ...themeStatePatch(nextData),
      } : {}),
      launcherStateDiagnostics: launcherStateGate.getDiagnostics(),
    },
  };
}

function launcherSnapshotPatch(snapshot) {
  return evaluateLauncherSnapshot(snapshot).patch;
}

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
  const directory = data?.library?.directory || {};

  if (!key) {
    return {};
  }

  if (unavailableDirectoryPrompts.has(key)) {
    return {};
  }

  unavailableDirectoryPrompts.add(key);
  return {
    activeDialog: {
      classification: directory.classification || directory.reason || "inaccessible",
      directoryKey: key,
      issue: "current-root-unavailable",
      type: "library-location",
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
      issue: "rejected-candidate",
      suggestedRootPath: result.suggestedRootPath || null,
      type: "library-location",
    },
  };
}

function detectedLibraryLocationDialogPatch(response, previousDialog) {
  const directory = response?.state?.library?.directory || {};
  if (previousDialog?.issue === "current-root-unavailable") {
    if (directory.available) return { activeDialog: null };
    return {
      activeDialog: {
        ...previousDialog,
        classification: directory.classification || directory.reason || previousDialog.classification || "inaccessible",
        feedback: response?.summary || "La Biblioteca recordada sigue sin estar disponible.",
      },
    };
  }

  if (response?.ok) return { activeDialog: null };
  const result = response?.result || {};
  return {
    activeDialog: {
      ...previousDialog,
      candidatePath: result.candidatePath || previousDialog?.candidatePath || null,
      classification: result.classification || previousDialog?.classification || "inaccessible",
      feedback: "No se ha podido detectar una Biblioteca v\u00e1lida.",
      suggestedRootPath: result.suggestedRootPath || null,
    },
  };
}

function resetUnavailableDirectoryPrompt(data) {
  const key = unavailableDirectoryKey(data);

  if (key) {
    unavailableDirectoryPrompts.delete(key);
  }
}

function applyTheme(theme) {
  const normalizedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  document.documentElement.style.colorScheme = normalizedTheme;
  document.documentElement.classList.remove("theme-bootstrap");
}

function elementInteractionIdentity(element) {
  for (const attribute of ["data-focus-key", "id", "name", "data-action"]) {
    const value = element.getAttribute?.(attribute);
    if (!value) continue;
    const attributes = { [attribute]: value };
    for (const qualifier of ["data-user-id", "data-pack-id", "data-favorite-key", "data-view", "data-filter"]) {
      const qualifierValue = element.getAttribute(qualifier);
      if (qualifierValue) attributes[qualifier] = qualifierValue;
    }
    return attributes;
  }

  return null;
}

function resolveInteractionIdentity(identity) {
  if (!identity) return null;
  const attributes = Object.entries(identity);
  if (attributes.length === 0) return null;
  return [...root.querySelectorAll(`[${attributes[0][0]}]`)]
    .find((element) => attributes.every(([attribute, value]) => element.getAttribute(attribute) === value)) || null;
}

function captureRegionInteraction(region) {
  const active = document.activeElement;
  const identity = active && region.contains(active) ? elementInteractionIdentity(active) : null;
  const focus = identity ? {
    attributes: identity,
    selectionEnd: Number.isInteger(active.selectionEnd) ? active.selectionEnd : null,
    selectionStart: Number.isInteger(active.selectionStart) ? active.selectionStart : null,
    value: "value" in active ? active.value : null,
  } : null;
  const scroll = preservedScrollElements(region).map((element) => ({
    key: element.dataset.preserveScroll,
    left: element.scrollLeft,
    top: element.scrollTop,
  }));

  return { focus, scroll };
}

function restoreRegionInteraction(region, interaction) {
  for (const saved of interaction.scroll) {
    const element = preservedScrollElements(region)
      .find((candidate) => candidate.dataset.preserveScroll === saved.key);
    if (!element) continue;
    element.scrollLeft = saved.left;
    element.scrollTop = saved.top;
  }

  if (!interaction.focus) return;
  const attributes = Object.entries(interaction.focus.attributes);
  const candidate = [...region.querySelectorAll(`[${attributes[0][0]}]`)]
    .find((element) => attributes.every(([attribute, value]) => element.getAttribute(attribute) === value));
  if (!candidate || candidate.disabled) return;

  if (interaction.focus.value !== null && "value" in candidate) {
    candidate.value = interaction.focus.value;
  }
  candidate.focus({ preventScroll: true });

  if (
    interaction.focus.selectionStart !== null &&
    typeof candidate.setSelectionRange === "function"
  ) {
    candidate.setSelectionRange(interaction.focus.selectionStart, interaction.focus.selectionEnd);
  }
}

function syncElementAttributes(element, source) {
  [...element.attributes].forEach(({ name }) => {
    if (!source.hasAttribute(name)) element.removeAttribute(name);
  });
  [...source.attributes].forEach(({ name, value }) => element.setAttribute(name, value));
}

function syncThemeControlRegion(region, html) {
  const currentButton = region.querySelector('[data-action="toggle-theme"]');
  if (!currentButton) return false;

  const template = document.createElement("template");
  template.innerHTML = String(html || "").trim();
  const nextButton = template.content.querySelector('[data-action="toggle-theme"]');
  if (!nextButton) return false;

  syncElementAttributes(currentButton, nextButton);
  currentButton.replaceChildren(...nextButton.childNodes);
  return true;
}

function writeRegion(region, html, name) {
  if (name === "header-theme" && syncThemeControlRegion(region, html)) return;
  const interaction = captureRegionInteraction(region);
  region.innerHTML = html;
  restoreRegionInteraction(region, interaction);
}

const regionRenderer = createRegionRenderer({
  findRegion: (name) => root.querySelector(`[data-render-region="${name}"]`),
  writeRegion,
});

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

function libraryPreferencesScopeKey(preferences = {}) {
  return preferences.scopeKey || (preferences.scope === "player" && preferences.playerKey
    ? `player:${preferences.playerKey}`
    : "global");
}

function snapshotPreferenceScope(data = {}) {
  return data.preferenceScope || data.library?.preferences || {};
}

function markLibraryPreferenceUserChange() {
  libraryPreferenceUserRevision += 1;
}

function libraryPreferencesStatePatch(data, current, allowHydration = true) {
  if (!allowHydration) {
    return {};
  }

  const preferences = data.library?.preferences || {};
  const scopeKey = libraryPreferencesScopeKey(snapshotPreferenceScope(data));

  if (hydratedLibraryPreferencesScopeKey === scopeKey) {
    return {};
  }

  hydratedLibraryPreferencesScopeKey = scopeKey;

  return {
    librarySidebarWidth: clampLibrarySidebarWidth(preferences.sidebarWidth || current.librarySidebarWidth),
    librarySortBy: preferences.librarySortBy || current.librarySortBy,
    librarySortDirection: preferences.librarySortDirection || current.librarySortDirection,
    libraryView: preferences.libraryView || current.libraryView,
  };
}

function themeStatePatch(data = {}) {
  const effectiveTheme = data.preferences?.theme?.effectiveTheme;
  return ["light", "dark"].includes(effectiveTheme) ? { theme: effectiveTheme } : {};
}

function currentLibraryPreferencesPatch(patch = {}) {
  const current = store.getState();

  return {
    librarySortBy: current.librarySortBy,
    librarySortDirection: current.librarySortDirection,
    libraryView: current.libraryView,
    scopeKey: libraryPreferencesScopeKey(snapshotPreferenceScope(current.data)),
    sidebarWidth: current.librarySidebarWidth,
    ...patch,
  };
}

function preloadImageUrl(url, timeoutMs = DETAIL_ASSET_PRELOAD_TIMEOUT_MS) {
  return assetPreloader.preload(url, { timeoutMs });
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

async function resolveStartupCriticalAssets(data) {
  if (!startupReadiness.getState().visible) return;
  const requestId = ++startupAssetSequence;
  const generation = data?.game?.visualAssetGeneration || 0;
  const urls = detailAssetUrlsFromGame(data?.game);
  const results = await preloadDetailAssetUrls(urls);
  if (requestId !== startupAssetSequence || !startupReadiness.getState().visible) return;
  if ((store.getState().data?.game?.visualAssetGeneration || 0) !== generation) return;
  const status = results.some((result) => result.status === "timeout")
    ? "timeout"
    : results.some((result) => result.status === "error") || urls.length === 0 ? "fallback" : "ready";
  startupReadiness.mark("criticalAssets", status);
  window.hslLauncher.reportStartupMilestone?.({ name: "assets-resolved", status });
}

function findLibraryPack(packId) {
  return store.getState().data?.library?.packs?.find((pack) => pack.id === packId) || null;
}

function resetLibraryResultsScroll() {
  const scroller = root.querySelector('[data-preserve-scroll="library-packs"]');
  if (scroller) scroller.scrollTop = 0;
}

async function refreshRemoteStateAfterPackActivation(requestId, expectedInstanceKey) {
  try {
    const nextData = await window.hslLauncher.getState();
    if (requestId !== libraryPackSelectionSequence) return;
    const contextMatches = nextData?.selection?.activeInstanceKey === expectedInstanceKey;
    store.setState({
      ...(contextMatches ? launcherSnapshotPatch(nextData) : {}),
      busy: false,
      busyLabel: null,
      libraryActivationInProgress: false,
    });
  } catch {
    // La activación aceptada sigue siendo autoritativa si el refresh falla.
    if (requestId === libraryPackSelectionSequence) {
      store.setState({
        busy: false,
        busyLabel: null,
        libraryActivationInProgress: false,
      });
    }
  }
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
      <aside class="drawer-layer" role="dialog" aria-modal="true" aria-label="${isActivity ? "Actividad local" : "Configuración del launcher"}" data-drawer>
        <div class="drawer-header">
          <div>
            <p class="eyebrow">${isActivity ? "Cola local" : "Launcher"}</p>
            <h2>${isActivity ? "Actividad local" : "Configuración"}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" data-overlay-initial-focus title="Cerrar" aria-label="Cerrar">
            ${renderIcon("close", { className: "button-icon drawer-close-icon", fallback: "", loading: "eager", size: "sm" })}
          </button>
        </div>
        <div class="drawer-body" data-preserve-scroll="drawer-body">
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

function openCleanAccountMenuState(state) {
  const empty = (state?.data?.accounts?.knownAccounts || []).length === 0;
  return {
    accountMenuOpen: true,
    ...cleanAccountFormState(),
    authFormOpen: empty,
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

function knownAccountForUserId(state, userId) {
  return (state.data?.accounts?.knownAccounts || []).find((account) => account.userId === userId) || null;
}

function libraryRegionHtml(state, packsModel = deriveLibraryPacksRenderModel(state)) {
  const packs = state.data?.library?.packs || [];
  return {
    "library-controls": renderLibraryControls(state, packs),
    "library-heading": renderLibraryHeading(state),
    "library-packs": renderLibraryPacks(state, packsModel),
  };
}

function gameRegionHtml(state) {
  return {
    "game-actions": renderGameActionsRegion(state),
    "game-activity": renderGameActivityRegion(state),
    "game-hero-indicators": renderGameHeroIndicatorsRegion(state),
    "game-identity": renderGameIdentityRegion(state),
    "game-visual": renderGameVisualRegion(state),
  };
}

function primeRegions(regions) {
  Object.entries(regions).forEach(([name, html]) => regionRenderer.prime(name, html));
}

function renderRegions(regions) {
  const changed = new Set();
  Object.entries(regions).forEach(([name, html]) => {
    if (regionRenderer.render(name, html)) changed.add(name);
  });
  return changed;
}

function primeLibraryRegions(state) {
  const model = deriveLibraryPacksRenderModel(state);
  primeRegions(libraryRegionHtml(state, model));
  currentLibraryPacksTopologyKey = libraryPacksTopologyKey(model);
}

function renderLibraryRegions(state) {
  const model = deriveLibraryPacksRenderModel(state);
  const regions = libraryRegionHtml(state, model);
  const libraryPacksHtml = regions["library-packs"];
  delete regions["library-packs"];
  const changed = renderRegions(regions);
  const topologyKey = libraryPacksTopologyKey(model);
  const region = root.querySelector('[data-render-region="library-packs"]');
  const result = applyLibraryPacksRenderPlan({
    currentTopologyKey: currentLibraryPacksTopologyKey,
    html: libraryPacksHtml,
    model,
    nextTopologyKey: topologyKey,
    region,
    regionRenderer,
    synchronize: (target, renderModel) => syncLibraryPackRegionState(target, state, renderModel),
  });

  if (result.wrote) {
    changed.add("library-packs");
  }

  currentLibraryPacksTopologyKey = topologyKey;
  return changed;
}

function gameStructureKey(state) {
  if (!state.data) return "loading";
  const fallback = shouldRenderLibraryBrandFallback(state);
  if (fallback) return `fallback:${fallback}`;
  const detailKey = detailScrollKeyFromState(state);
  if (detailKey && state.data.game) return `detail:${detailKey}`;
  return "fallback:empty";
}

function syncLibraryControlValues(state) {
  const search = root.querySelector("[data-library-search]");
  if (search instanceof HTMLInputElement && document.activeElement !== search) {
    search.value = state.libraryQuery;
  }

  const season = root.querySelector("[data-library-season]");
  if (season instanceof HTMLSelectElement && season.value !== state.librarySeason) {
    season.value = state.librarySeason;
  }
  const sortBy = root.querySelector("[data-library-sort-by]");
  if (sortBy instanceof HTMLSelectElement && sortBy.value !== state.librarySortBy) {
    sortBy.value = state.librarySortBy;
  }
}

function mountRenderer(state) {
  const sidebarWidth = clampLibrarySidebarWidth(state.librarySidebarWidth);
  root.innerHTML = `
    ${renderHeader(state)}
    <main class="app-main" style="--library-sidebar-width: ${sidebarWidth}px">
      <aside class="library-panel-region">
        <div class="library-scroll" data-render-region="library-panel">
          ${renderLibraryPanel(state)}
        </div>
      </aside>
      <div class="library-resizer" data-sidebar-resizer role="separator" aria-orientation="vertical" aria-label="Ajustar anchura de biblioteca" aria-valuemin="${LIBRARY_SIDEBAR_MIN}" aria-valuemax="${LIBRARY_SIDEBAR_MAX}" aria-valuenow="${sidebarWidth}" tabindex="0"></div>
      <section class="game-panel-region">
        <div class="game-scroll" data-render-region="game-panel">
          ${renderGamePanel(state)}
        </div>
      </section>
    </main>
    ${renderStatusFooter()}
    <div id="hsl-live-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div class="render-region-contents" data-render-region="overlay">${renderOverlay(state)}</div>
    <div class="render-region-contents" data-render-region="dialog">${renderAppDialog(state)}</div>
    <div class="render-region-contents" data-render-region="busy-overlay">${renderBusyOverlay(state)}</div>
  `;
  regionRenderer.clear();
  primeRegions({
    "busy-overlay": renderBusyOverlay(state),
    dialog: renderAppDialog(state),
    "game-panel": renderGamePanel(state),
    "header-account": renderAccountControl(state),
    "header-connection": renderConnectionControl(state),
    "header-theme": renderThemeControl(state),
    "library-panel": renderLibraryPanel(state),
    overlay: renderOverlay(state),
  });
  if (state.data) primeLibraryRegions(state);
  if (state.data?.game && detailScrollKeyFromState(state)) primeRegions(gameRegionHtml(state));
  currentLibraryStructureKey = state.data ? "ready" : "loading";
  if (!state.data) currentLibraryPacksTopologyKey = null;
  currentGameStructureKey = gameStructureKey(state);
  currentDetailScrollKey = detailScrollKeyFromState(state);
  rendererMounted = true;
}

function resetLoginDraft(email = "") {
  loginDraft.clear();
  pendingLoginDraftSeed = String(email || "");
}

function prepareLoginDraftForRender(state) {
  if (pendingLoginDraftSeed !== null) {
    loginDraft.seed(pendingLoginDraftSeed);
    pendingLoginDraftSeed = null;
  } else if (loginDraftOpen) {
    loginDraft.capture(root.querySelector("[data-auth-form]"));
  } else if (state.authFormOpen) {
    loginDraft.seed(state.authEmail || "");
  }

  if (!state.authFormOpen) loginDraft.clear();
}

function finishLoginDraftRender(state) {
  if (state.authFormOpen) loginDraft.restore(root.querySelector("[data-auth-form]"));
  loginDraftOpen = Boolean(state.authFormOpen);
}

function syncLiveAnnouncement(previousState, state, changedKeys) {
  const message = deriveLiveAnnouncement(previousState, state, changedKeys);
  const region = root.querySelector("#hsl-live-status");
  if (message && region && region.textContent !== message) region.textContent = message;
}

function render(nextState, changedKeys = []) {
  const state = nextState || store.getState();
  if (!rendererMounted || changedKeys.includes("theme")) {
    applyTheme(state.theme);
  }

  if (!rendererMounted) {
    prepareLoginDraftForRender(state);
    mountRenderer(state);
    finishLoginDraftRender(state);
    syncLibraryControlValues(state);
    syncGameMetadataLayout();
    syncResolvedVisualAssets();
    syncDialogFocus(state);
    syncOverlayFocus(state);
    lastRenderedState = state;
    return;
  }

  root.querySelector(".app-main")?.style.setProperty(
    "--library-sidebar-width",
    `${clampLibrarySidebarWidth(state.librarySidebarWidth)}px`,
  );
  root.querySelector("[data-sidebar-resizer]")?.setAttribute(
    "aria-valuenow",
    String(clampLibrarySidebarWidth(state.librarySidebarWidth)),
  );
  if (changedKeys.length === 1 && changedKeys[0] === "librarySidebarWidth") {
    lastRenderedState = state;
    return;
  }
  prepareLoginDraftForRender(state);
  renderRegions({
    "header-account": renderAccountControl(state),
    "header-connection": renderConnectionControl(state),
    "header-theme": renderThemeControl(state),
  });

  const nextLibraryStructureKey = state.data ? "ready" : "loading";
  if (nextLibraryStructureKey !== currentLibraryStructureKey) {
    regionRenderer.render("library-panel", renderLibraryPanel(state));
    currentLibraryStructureKey = nextLibraryStructureKey;
    if (state.data) primeLibraryRegions(state);
    else currentLibraryPacksTopologyKey = null;
  } else if (state.data) {
    renderLibraryRegions(state);
  }

  const nextDetailScrollKey = detailScrollKeyFromState(state);
  const nextGameStructureKey = gameStructureKey(state);
  let gameLayoutChanged = false;
  if (nextGameStructureKey !== currentGameStructureKey) {
    regionRenderer.render("game-panel", renderGamePanel(state));
    currentGameStructureKey = nextGameStructureKey;
    if (state.data?.game && nextDetailScrollKey) primeRegions(gameRegionHtml(state, lastRenderedState));
    if (currentDetailScrollKey && nextDetailScrollKey !== currentDetailScrollKey) {
      const gameScroll = root.querySelector(".game-scroll");
      if (gameScroll) gameScroll.scrollTop = 0;
    }
    gameLayoutChanged = true;
  } else if (nextGameStructureKey.startsWith("detail:") && state.data?.game && nextDetailScrollKey) {
    const changed = renderRegions(gameRegionHtml(state, lastRenderedState));
    gameLayoutChanged = changed.has("game-identity") || changed.has("game-visual");
  } else {
    gameLayoutChanged = regionRenderer.render("game-panel", renderGamePanel(state));
  }
  currentDetailScrollKey = nextDetailScrollKey;

  renderRegions({
    "busy-overlay": renderBusyOverlay(state),
    dialog: renderAppDialog(state),
    overlay: renderOverlay(state),
  });
  syncLibraryControlValues(state);
  if (gameLayoutChanged) {
    syncGameMetadataLayout();
  }
  syncResolvedVisualAssets();
  syncDialogFocus(state);
  syncOverlayFocus(state);
  finishLoginDraftRender(state);
  syncLiveAnnouncement(lastRenderedState, state, changedKeys);
  lastRenderedState = state;
}

function visualAssetContext(image) {
  const state = store.getState();
  const kind = image.dataset.assetKind || "";
  if (image.dataset.assetScope === "detail") {
    const game = state.data?.game || {};
    const byKind = {
      cover: game.assets?.cover?.url,
      hero: game.assets?.hero?.url,
      icon: game.assets?.icon?.url,
      logo: game.assets?.logo?.url,
    };
    return {
      generation: game.visualAssetGeneration || 0,
      kind,
      selection: state.data?.selection?.activeInstanceKey || game.instanceKey || "none",
      url: byKind[kind] || "",
    };
  }

  const pack = state.data?.library?.packs?.find((item) => item.instanceKey === image.dataset.assetSelection);
  const byKind = {
    cover: pack?.cover?.url,
    "cover-fallback": pack?.cover?.url,
    icon: pack?.icon?.url,
  };
  return {
    generation: image.dataset.assetGeneration || "",
    kind,
    selection: pack?.instanceKey || "",
    url: byKind[kind] || "",
  };
}

function settleVisualAsset(image, status) {
  if (!image?.isConnected || !assetIdentityMatches(image, visualAssetContext(image))) return false;
  const container = image.closest("[data-asset-container]");
  if (image.dataset.assetScope === "library") {
    const adaptiveCard = container?.closest(".pack-card--list, .pack-card--icons");
    if (adaptiveCard) {
      container.dataset.artPresentation = status === "loaded"
        ? resolveLibraryArtPresentation(image)
        : "unknown";
    }
  }
  image.dataset.assetStatus = status;
  image.hidden = status !== "loaded";
  container?.classList.toggle("asset-ready", status === "loaded");
  container?.classList.toggle("asset-failed", status !== "loaded");
  if (image.dataset.assetScope === "detail" && ["logo", "icon"].includes(image.dataset.assetKind)) {
    const stage = container?.closest(".game-hero-stage");
    stage?.classList.toggle("game-hero-stage--logo-ready", status === "loaded");
    if (status !== "loaded") stage?.classList.remove("game-hero-stage--with-logo");
  }
  return true;
}

function syncResolvedVisualAssets(scope = root) {
  for (const image of scope.querySelectorAll?.("img[data-visual-asset]") || []) {
    if (!image.complete) continue;
    settleVisualAsset(image, image.naturalWidth > 0 ? "loaded" : "error");
  }
}

function syncDialogFocus(state) {
  const dialogType = state.activeDialog?.type || null;

  if (dialogType === currentDialogType) {
    return;
  }

  if (dialogType && !currentDialogType) {
    dialogReturnFocus = document.activeElement;
    dialogReturnFocusIdentity ||= elementInteractionIdentity(dialogReturnFocus);
  }
  const closing = !dialogType && currentDialogType;
  currentDialogType = dialogType;
  window.requestAnimationFrame(() => {
    if (dialogType) {
      root.querySelector("[data-dialog-initial-focus]")?.focus();
    } else if (closing) {
      const target = resolveInteractionIdentity(dialogReturnFocusIdentity)
        || (dialogReturnFocus?.isConnected && dialogReturnFocus !== document.body
          ? dialogReturnFocus
          : null);
      target?.focus({ preventScroll: true });
    }
    if (!dialogType) {
      dialogReturnFocus = null;
      dialogReturnFocusIdentity = null;
    }
  });
}

function syncOverlayFocus(state) {
  const overlayType = state.activeOverlay || null;
  if (overlayType === currentOverlayType) return;

  if (overlayType && !currentOverlayType) {
    overlayReturnFocus = document.activeElement;
  }
  const closing = !overlayType && currentOverlayType;
  currentOverlayType = overlayType;
  window.requestAnimationFrame(() => {
    if (overlayType) {
      root.querySelector("[data-overlay-initial-focus]")?.focus();
    } else if (closing && overlayReturnFocus?.isConnected) {
      overlayReturnFocus.focus({ preventScroll: true });
    }
    if (!overlayType) overlayReturnFocus = null;
  });
}

async function refreshState() {
  const startedWithLibraryPreferenceRevision = libraryPreferenceUserRevision;
  const data = await window.hslLauncher.getInitialState();
  const current = store.getState();
  const allowLibraryPreferenceHydration = startedWithLibraryPreferenceRevision === libraryPreferenceUserRevision;
  const snapshot = evaluateLauncherSnapshot(data, { allowPreferenceHydration: allowLibraryPreferenceHydration });
  if (!snapshot.accepted) {
    if (store.getState().data) {
      store.setState(snapshot.patch);
      return;
    }
    store.setState({ ...snapshot.patch, initialLoadError: "No se pudo aceptar el estado local inicial." });
    startupReadiness.mark("localState", "error");
    startupReadiness.mark("library", "degraded");
    startupReadiness.mark("selection", "degraded");
    startupReadiness.mark("criticalAssets", "fallback");
    return;
  }
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
    ...snapshot.patch,
    initialLoadError: null,
    libraryFavoriteFilter: data.session?.hasSession ? current.libraryFavoriteFilter : "all",
    logs: noticeLogs.reduce((logs, notice) => appendLog(logs, notice), current.logs),
    noticeIds: [
      ...current.noticeIds,
      ...(data.notices || []).map((notice) => notice.id),
    ],
  });
  const acceptedData = snapshot.patch.data;
  const startupPhases = classifyStartupSnapshot(acceptedData);
  startupReadiness.mark("localState", "ready");
  startupReadiness.mark("library", startupPhases.library);
  startupReadiness.mark("selection", startupPhases.selection);
  window.hslLauncher.reportStartupMilestone?.({ name: "first-snapshot", status: "ready" });
  window.hslLauncher.reportStartupMilestone?.({
    name: "selection-stable",
    status: startupPhases.selection,
  });
  resolveStartupCriticalAssets(acceptedData).catch(() => {
    startupReadiness.mark("criticalAssets", "fallback");
  });
}

async function setManualTheme(theme) {
  try {
    const scopeKey = libraryPreferencesScopeKey(snapshotPreferenceScope(store.getState().data));
    const result = await window.hslLauncher.setTheme(theme, scopeKey);
    if (result?.ok === false) {
      const error = new Error("No se pudo persistir el tema. La apariencia actual se mantiene.");
      error.code = result.persistenceError || "THEME_PERSISTENCE_FAILED";
      throw error;
    }
    const effectiveTheme = result?.effectiveTheme === "light" ? "light" : result?.effectiveTheme === "dark" ? "dark" : null;
    if (effectiveTheme && result?.scopeKey === libraryPreferencesScopeKey(snapshotPreferenceScope(store.getState().data))) {
      store.setState({ theme: effectiveTheme });
    }
  } catch (error) {
    store.setState({
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudo guardar el tema. La apariencia actual se mantiene.",
        title: "Tema",
      }),
    });
  }
}

async function toggleManualThemeAfterAccountClose(accountMenuWasOpen) {
  if (accountMenuWasOpen || store.getState().accountMenuOpen) {
    store.setState(closeAccountMenuState());
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
  }

  return setManualTheme(store.getState().theme === "dark" ? "light" : "dark");
}

async function persistLibraryPreferences(patch) {
  const requestId = ++libraryPreferencesPersistSequence;

  try {
    await window.hslLauncher.setLibraryPreferences(patch.scopeKey ? patch : currentLibraryPreferencesPatch(patch));
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
  const captured = currentLibraryPreferencesPatch(patch);
  if (pendingLibraryPreferencesPatch.scopeKey && pendingLibraryPreferencesPatch.scopeKey !== captured.scopeKey) {
    const previous = pendingLibraryPreferencesPatch;
    pendingLibraryPreferencesPatch = {};
    persistLibraryPreferences(previous);
  }
  pendingLibraryPreferencesPatch = { ...pendingLibraryPreferencesPatch, ...captured };

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

async function flushPendingLibraryPreferences() {
  if (!libraryPreferencesPersistTimer) return;
  window.clearTimeout(libraryPreferencesPersistTimer);
  libraryPreferencesPersistTimer = null;
  const nextPatch = pendingLibraryPreferencesPatch;
  pendingLibraryPreferencesPatch = {};
  if (nextPatch.scopeKey) await persistLibraryPreferences(nextPatch);
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

function applyConnectivityState(connectivityState) {
  if (!["unknown", "offline", "connecting", "reconnecting", "connected"].includes(connectivityState?.displayStatus)) return;
  const currentGeneration = Number(store.getState().connectivity?.reachabilityGeneration) || 0;
  const nextGeneration = Number(connectivityState.reachabilityGeneration) || 0;
  if (nextGeneration < currentGeneration) return;
  const receivedAt = new Date().toISOString();
  store.setState({ connectivity: { ...connectivityState, receivedAt } });
  const appliedState = store.getState();
  const remoteAvailability = deriveRemoteAvailability(appliedState.connectivity);
  const ranking = getRankingActionState(appliedState, appliedState.data?.game);
  const capability = appliedState.rankingCapabilities?.entries?.[appliedState.data?.game?.weekId];
  const inconsistency = remoteAvailability.status === "offline" && ranking.available
    ? "offline-ranking-enabled"
    : remoteAvailability.status === "connected" && capability?.status === "available" && !ranking.available && !appliedState.rankingOpening
      ? "connected-available-ranking-disabled"
      : null;
  window.hslLauncher.reportConnectivityApplied?.({
    appliedAt: new Date().toISOString(),
    emittedAt: connectivityState.emittedAt || null,
    inconsistency,
    rankingEnabled: ranking.available,
    receivedAt,
    remoteAvailability,
    rendererStateRevision: appliedState.rendererStateRevision,
  });
}

function applyRankingCapabilitiesState(capabilitiesState) {
  if (!capabilitiesState || typeof capabilitiesState !== "object") return;
  const currentSequence = Number(store.getState().rankingCapabilities?.stateSequence) || 0;
  const nextSequence = Number(capabilitiesState.stateSequence) || 0;
  if (nextSequence < currentSequence) return;
  const receivedAt = new Date().toISOString();
  store.setState({ rankingCapabilities: capabilitiesState });
  window.hslLauncher.reportRankingApplied?.({
    appliedAt: new Date().toISOString(),
    receivedAt,
    stateSequence: nextSequence,
  });
}

function applyBackgroundLauncherState(payload) {
  if (!payload?.state) return;
  const sent = Number(payload.autoSubmit?.sent) || 0;
  const snapshot = evaluateLauncherSnapshot(payload.state);
  store.setState({
    ...snapshot.patch,
    ...(snapshot.accepted && sent > 0 ? {
      logs: appendLog(store.getState().logs, {
        details: [],
        ok: true,
        summary: `Se han enviado ${sent} puntuaciones pendientes.`,
        title: "Sincronizaci\u00f3n autom\u00e1tica",
      }),
    } : {}),
  });
  if (snapshot.accepted && startupReadiness.getState().visible) {
    const acceptedData = snapshot.patch.data;
    const startupPhases = classifyStartupSnapshot(acceptedData);
    startupReadiness.mark("localState", "ready");
    startupReadiness.mark("library", startupPhases.library);
    startupReadiness.mark("selection", startupPhases.selection);
    resolveStartupCriticalAssets(acceptedData).catch(() => startupReadiness.mark("criticalAssets", "fallback"));
  }
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

      const snapshot = evaluateLauncherSnapshot(response.state);
      if (snapshot.accepted) {
        store.setState(snapshot.patch);
      } else {
        store.setState({
          ...snapshot.patch,
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

function rankingFeedbackContextKey(data = store.getState().data) {
  return [
    data?.selection?.activeInstanceKey || data?.game?.instanceKey || "",
    data?.game?.weekId || "",
    data?.session?.userId || data?.accounts?.activeUserId || "",
  ].join("\u001f");
}

function invalidateStaleRankingFeedback(nextData) {
  if (!activeRankingFeedback) return {};
  if (activeRankingFeedback.contextKey === rankingFeedbackContextKey(nextData)) return {};
  cancelActiveOperationFeedback();
  activeRankingFeedback = null;
  return { busy: false, busyLabel: null, rankingOpening: false };
}

async function openRankingWithOperationFeedback() {
  if (activeRankingFeedback || store.getState().busy) return;
  const contextKey = rankingFeedbackContextKey();

  try {
    await runWithOperationFeedback({
      scope: "external",
      isCurrent: (runId) => activeRankingFeedback?.runId === runId,
      onStart: ({ runId }) => {
        activeRankingFeedback = { contextKey, runId };
        store.setState({ busy: true, busyLabel: "Abriendo ranking", rankingOpening: true });
      },
      operation: () => window.hslLauncher.openRanking(),
      onFinish: ({ error, result, runId }) => {
        const activeRun = activeRankingFeedback;
        if (!activeRun || activeRun.runId !== runId) return;

        const currentContextKey = rankingFeedbackContextKey();
        const responseContextKey = result?.state
          ? rankingFeedbackContextKey(result.state)
          : currentContextKey;
        const contextStillMatches = activeRun.contextKey === currentContextKey
          && activeRun.contextKey === responseContextKey;
        activeRankingFeedback = null;

        if (!contextStillMatches) {
          store.setState({ busy: false, busyLabel: null, rankingOpening: false });
          return;
        }

        const nextState = { busy: false, busyLabel: null, rankingOpening: false };
        if (error || !result || typeof result !== "object") {
          nextState.logs = appendLog(store.getState().logs, {
            details: [],
            ok: false,
            summary: "No se pudo abrir el ranking. Int\u00e9ntalo de nuevo.",
            title: "Ver ranking",
          });
        } else {
          Object.assign(nextState, launcherSnapshotPatch(result?.state));
          nextState.logs = appendLog(store.getState().logs, resultToLog("Ver ranking", result || {}));
        }
        store.setState(nextState);
      },
    });
  } catch {
    // onFinish presenta el error si la ventana y el contexto siguen vigentes.
  }
}

function updateSidebarWidth(width, save = false) {
  const nextWidth = clampLibrarySidebarWidth(width);

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
  const details = [...lines, ...(response.technicalDetails || []), ...extra];
  const friendly = {
    login: ok
      ? "Login correcto."
      : "El email o la contraseña no son correctos. Inténtalo de nuevo.",
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
    "check-membership": ok ? "Participación en la temporada actualizada." : response.summary || "No se pudo actualizar la participación.",
    "import-pack": response.summary || (ok
      ? "Pack importado."
      : "No se pudo completar la importación. No se ha instalado nada."),
    "open-pack-directory": response.summary || "Directorio de packs abierto.",
    "open-manual": response.summary || (ok ? "Manual abierto." : "Este pack todavía no incluye manual local."),
    "open-ranking": response.summary || (ok ? "Ranking abierto en la web." : "Ranking integrado pendiente."),
    "open-shared-mame-runtime": response.summary || "Carpeta MAME abierta.",
    "remove-known-account": response.summary || (ok
      ? "Cuenta quitada de este dispositivo. No se han borrado puntuaciones locales."
      : "No se pudo quitar la cuenta recordada."),
    "use-library-pack": response.summary || (ok
      ? "Pack activado desde biblioteca."
      : "No se pudo activar el pack desde biblioteca."),
    "play-competition": ok
      ? "MAME se cerró correctamente. La cola local se ha actualizado."
      : response.mameSpawned === true
        ? "MAME terminó con aviso. Si jugaste una partida, revisa la cola local."
        : response.summary || lines[0] || "No se pudo abrir la competición.",
    practice: ok
      ? "Práctica cerrada. No se activó el plugin de puntuación desde el launcher."
      : "La práctica terminó con aviso.",
    "refresh-connectivity": response.summary || (ok
      ? "Conexión con High Score League confirmada."
      : "No se pudo conectar con High Score League."),
    refresh: "Estado local actualizado.",
    "rescan-pack-directory": response.summary || "Biblioteca reescaneada.",
    "restore-failed": ok
      ? "Puntuación restaurada a pendientes. Puedes reintentar cuando el problema esté corregido."
      : "No se pudo restaurar la puntuación.",
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
    summary: friendly[response.action] || (ok ? "Acción completada." : "La acción necesita revisión."),
    title,
  };
}

async function runAction(action, busyLabel, title, fn, options = {}) {
  if (store.getState().busy) return;

  const runId = ++busyRunSequence;
  const shouldRestoreTriggerFocus = options.restoreTriggerFocus === true
    && document.activeElement?.closest?.(`[data-action="${action}"]`);
  const restoreTriggerFocus = () => {
    if (!shouldRestoreTriggerFocus) return;
    const trigger = root.querySelector(`[data-action="${action}"]`);
    if (trigger && !trigger.disabled) trigger.focus({ preventScroll: true });
  };
  try {
    const response = await runWithOperationFeedback({
      isCurrent: () => runId === busyRunSequence,
      scope: options.scope || "transient",
      onStart: () => {
        if (activeBusyPhaseTimer !== null) window.clearTimeout(activeBusyPhaseTimer);
        activeBusyPhaseTimer = null;
        store.setState({
          ...closeAccountMenuState(),
          busy: true,
          busyLabel,
        });

        if (options.runningLabel && options.phaseDriven !== true) {
          activeBusyPhaseTimer = window.setTimeout(() => {
            const current = store.getState();

            if (runId === busyRunSequence && current.busy) {
              store.setState({ busyLabel: options.runningLabel });
            }
          }, options.runningDelayMs || 1200);
        }
      },
      operation: async () => {
        const value = await fn();
        if (activeBusyPhaseTimer !== null) window.clearTimeout(activeBusyPhaseTimer);
        activeBusyPhaseTimer = null;

        if (options.closingLabel && value?.mameSpawned === true) {
          store.setState({ busyLabel: options.closingLabel });
          await delay(options.closingDelayMs || 450);
        }
        return value;
      },
    });

    if (runId !== busyRunSequence) return;

    const statePatch = {
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, resultToLog(title, response)),
    };

    if (response.state) {
      const snapshot = evaluateLauncherSnapshot(response.state);
      Object.assign(statePatch, snapshot.patch);
      if (snapshot.accepted) {
        Object.assign(statePatch, libraryUnavailableStatePatch(response.state), { initialLoadError: null });
      }

      if (snapshot.accepted && options.promptForUnavailableDirectory) {
        Object.assign(statePatch, unavailableDirectoryDialogPatch(response.state));
      }
    }

    if (options.promptForRejectedLibraryRoot) {
      Object.assign(statePatch, rejectedLibraryRootDialogPatch(response));
    }

    if (options.promptForDetectedLibraryLocation) {
      Object.assign(statePatch, detectedLibraryLocationDialogPatch(response, options.libraryLocationDialog));
    }

    store.setState(statePatch);
    restoreTriggerFocus();
    if (action === "choose-pack-directory" && !store.getState().activeDialog) {
      dialogReturnFocusIdentity = null;
    }
  } catch (error) {
    if (activeBusyPhaseTimer !== null) window.clearTimeout(activeBusyPhaseTimer);
    activeBusyPhaseTimer = null;

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
    restoreTriggerFocus();
    if (action === "choose-pack-directory" && !store.getState().activeDialog) {
      dialogReturnFocusIdentity = null;
    }
  }
}

async function submitLogin(form) {
  if (store.getState().busy) return;

  const { email, password } = loginDraft.take(form);

  store.setState({ authError: null, busy: true, busyLabel: "Conectando" });

  try {
    const response = await runWithOperationFeedback({
      operation: async () => {
        await flushPendingLibraryPreferences();
        return window.hslLauncher.login(email, password);
      },
    });

    store.setState({
      authError: response.ok ? null : response.summary || "El email o la contraseña no son correctos. Inténtalo de nuevo.",
      authEmail: response.ok ? "" : email,
      authFormOpen: !response.ok,
      accountMenuOpen: !response.ok,
      busy: false,
      busyLabel: null,
      ...launcherSnapshotPatch(response.state),
      logs: appendLog(store.getState().logs, resultToLog("Iniciar sesión", response)),
    });
  } catch {
    store.setState({
      authError: "El email o la contraseña no son correctos. Inténtalo de nuevo.",
      accountMenuOpen: true,
      authFormOpen: true,
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [],
        ok: false,
        summary: "El email o la contraseña no son correctos. Inténtalo de nuevo.",
        title: "Iniciar sesión",
      }),
    });
  }
}

async function switchAccount(button) {
  const currentState = store.getState();
  if (currentState.busy) return;

  const email = button.dataset.email || "";
  const userId = button.dataset.userId;

  if (!userId) {
    resetLoginDraft(email);
    store.setState(openAccountFormState(email));
    return;
  }

  const knownAccount = knownAccountForUserId(currentState, userId);
  if (knownAccount?.requiresLogin === true) {
    const reloginEmail = knownAccount.email || email;
    resetLoginDraft(reloginEmail);
    store.setState({
      ...openAccountFormState(reloginEmail),
      authError: knownAccount.requiresLoginMessage || "Inicia sesión de nuevo para esta cuenta.",
    });
    return;
  }

  resetLoginDraft();

  try {
    const response = await runWithOperationFeedback({
      onStart: () => store.setState({
        ...cleanAccountFormState(),
        busy: true,
        busyLabel: "Cambiando cuenta",
        operationFeedbackMode: "overlay",
      }),
      operation: async () => {
        await flushPendingLibraryPreferences();
        return window.hslLauncher.switchAccount(userId);
      },
    });
    const nextState = {
      busy: false,
      busyLabel: null,
      operationFeedbackMode: "overlay",
      ...launcherSnapshotPatch(response.state),
    };

    if (shouldSurfaceAccountSwitchResult(response)) {
      nextState.logs = appendLog(store.getState().logs, resultToLog("Cambiar cuenta", response));
    }

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
      operationFeedbackMode: "overlay",
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

  try {
    const response = await runWithOperationFeedback({
      isCurrent: () => requestId === libraryPackSelectionSequence,
      onStart: () => {
        store.setState({
          ...closeAccountMenuState(),
          busy: true,
          busyLabel: "Activando pack",
          libraryActivationInProgress: true,
          pendingLibraryPackId: safePackId,
        });
      },
      operation: async () => {
        const result = await window.hslLauncher.useLibraryPack(safePackId);

        if (requestId !== libraryPackSelectionSequence) return result;
        await optimisticPreload;

        if (result.state) {
          await preloadDetailAssetUrls(detailAssetUrlsFromGame(result.state.game));
        }
        return result;
      },
    });

    if (requestId !== libraryPackSelectionSequence) return;

    store.setState({
      busyLabel: "Comprobando pack",
      ...launcherSnapshotPatch(response.state),
      logs: appendLog(store.getState().logs, resultToLog("Usar pack de biblioteca", response)),
      pendingLibraryPackId: null,
    });
    refreshRemoteStateAfterPackActivation(
      requestId,
      response.state?.selection?.activeInstanceKey || response.pack?.instanceKey || null,
    );
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
  root.addEventListener("load", (event) => {
    const image = event.target instanceof Element ? event.target.closest("[data-hsl-icon-image]") : null;
    if (image) markIconLoaded(image.closest("[data-icon]")?.dataset.icon || "info", image);
    const visualAsset = event.target instanceof Element ? event.target.closest("[data-visual-asset]") : null;
    if (visualAsset) settleVisualAsset(visualAsset, "loaded");
  }, true);

  root.addEventListener("error", (event) => {
    const iconImage = event.target instanceof Element ? event.target.closest("[data-hsl-icon-image]") : null;
    if (iconImage) markIconMissing(iconImage.closest("[data-icon]")?.dataset.icon || "info", iconImage);
    const visualAsset = event.target instanceof Element ? event.target.closest("[data-visual-asset]") : null;
    if (visualAsset) settleVisualAsset(visualAsset, "error");
    const loadingImage = event.target instanceof Element ? event.target.closest("[data-hsl-loading-image]") : null;
    if (loadingImage) {
      loadingImage.hidden = true;
      if (loadingImage.nextElementSibling) loadingImage.nextElementSibling.hidden = false;
    }
  }, true);

  root.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-library-search]") : null;
    if (!input) return;

    if (input.value === store.getState().libraryQuery) return;
    resetLibraryResultsScroll();
    store.setState({ libraryQuery: input.value });
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    if (target.matches("[data-library-season]")) {
      if (target.value === store.getState().librarySeason) return;
      resetLibraryResultsScroll();
      store.setState({ librarySeason: target.value });
    }

    if (target.matches("[data-library-sort-by]")) {
      const librarySortBy = target.value;
      if (librarySortBy === store.getState().librarySortBy) return;
      resetLibraryResultsScroll();
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
      startWidth: clampLibrarySidebarWidth(store.getState().librarySidebarWidth),
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

    const button = target?.closest("[data-action]");
    const action = button?.dataset.action;

    if (action === "toggle-theme") {
      const accountMenuWasOpen = current.accountMenuOpen;
      themeToggleQueue = themeToggleQueue.then(() => (
        toggleManualThemeAfterAccountClose(accountMenuWasOpen)
      ));
      return;
    }

    if (
      current.accountMenuOpen &&
      target &&
      !target.closest("[data-dialog]") &&
      !target.closest("[data-account-menu]") &&
      !target.closest("[data-action='toggle-account-menu']")
    ) {
      if (!pointerStartedInsideAccountMenu) {
        store.setState(closeAccountMenuState());
      }
    }

    if (!button) return;

    if (action === "show-settings") {
      store.setState({ ...closeAccountMenuState(), activeOverlay: "advanced" });
    }

    if (action === "toggle-account-menu") {
      const accountState = store.getState();
      resetLoginDraft();
      store.setState(accountState.accountMenuOpen ? closeAccountMenuState() : openCleanAccountMenuState(accountState));
    }

    if (action === "show-activity-details") {
      if (!store.getState().data?.session?.hasSession) {
        return;
      }
      store.setState({ ...closeAccountMenuState(), activeOverlay: "activity" });
    }

    if (action === "toggle-library-sort-direction") {
      const librarySortDirection = button.dataset.direction === "desc" ? "desc" : "asc";
      if (librarySortDirection === store.getState().librarySortDirection) return;
      resetLibraryResultsScroll();
      markLibraryPreferenceUserChange();
      store.setState({ librarySortDirection });
      persistLibraryPreferencesSoon({ librarySortDirection });
    }

    if (action === "toggle-library-favorite-filter") {
      if (button.disabled || !store.getState().data?.session?.hasSession) {
        return;
      }

      resetLibraryResultsScroll();
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
      resetLoginDraft();
      store.setState(openAccountFormState());
    }

    if (action === "add-account") {
      resetLoginDraft();
      store.setState(openAccountFormState());
    }

    if (action === "switch-account") {
      switchAccount(button);
    }

    if (action === "cancel-login") {
      resetLoginDraft();
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
      runAction(action, "Abriendo pack", COPY.actions.openPack, () => window.hslLauncher.openPack(), { scope: "interactive" });
    }

    if (action === "choose-pack-directory") {
      dialogReturnFocusIdentity = elementInteractionIdentity(button);
      runAction(action, "Eligiendo directorio", "Elegir directorio", () => window.hslLauncher.choosePackDirectory(), {
        promptForRejectedLibraryRoot: true,
        restoreTriggerFocus: true,
        scope: "interactive",
      });
    }

    if (action === "choose-library-location") {
      store.setState({ activeDialog: null });
      runAction("choose-pack-directory", "Eligiendo directorio", "Elegir directorio", () => window.hslLauncher.choosePackDirectory(), {
        promptForRejectedLibraryRoot: true,
        restoreTriggerFocus: true,
        scope: "interactive",
      });
    }

    if (action === "detect-library-location") {
      const libraryLocationDialog = current.activeDialog;
      if (libraryLocationDialog?.issue === "current-root-unavailable") {
        resetUnavailableDirectoryPrompt(current.data);
      }
      runAction(action, "Detectando biblioteca", "Detectar packs", () => (
        window.hslLauncher.detectLibraryLocation(libraryLocationDialog?.candidatePath || null)
      ), {
        libraryLocationDialog,
        promptForDetectedLibraryLocation: true,
      });
    }

    if (action === "import-pack") {
      store.setState({ activeDialog: { type: "import-pack" } });
    }

    if (action === "import-pack-zip") {
      store.setState({ activeDialog: null });
      runAction("import-pack", "Eligiendo ZIP", "Importar pack", () => window.hslLauncher.importPackZip(), { scope: "interactive" });
    }

    if (action === "import-pack-folder") {
      store.setState({ activeDialog: null });
      runAction("import-pack", "Eligiendo carpeta", "Importar pack", () => window.hslLauncher.importPackFolder(), { scope: "interactive" });
    }

    if (action === "choose-shared-mame-runtime") {
      runAction(action, "Eligiendo MAME", "Elegir mame.exe", () => window.hslLauncher.chooseSharedMameRuntime(), { scope: "interactive" });
    }

    if (action === "open-pack-directory") {
      runAction(action, "Abriendo directorio", "Abrir directorio", () => window.hslLauncher.openPackDirectory(), { scope: "external" });
    }

    if (action === "open-shared-mame-runtime") {
      runAction(action, "Abriendo MAME", "Abrir carpeta MAME", () => window.hslLauncher.openSharedMameRuntime(), { scope: "external" });
    }

    if (action === "rescan-pack-directory") {
      resetUnavailableDirectoryPrompt(store.getState().data);
      runAction(action, "Reescaneando", "Reescanear", () => window.hslLauncher.rescanPackDirectory(), {
        promptForUnavailableDirectory: true,
      });
    }

    if (action === "use-library-pack") {
      const packId = button.dataset.packId;
      activateLibraryPackWithPreload(packId);
    }

    if (action === "open-membership-url") {
      runAction(action, "Abriendo web", "Abrir temporada en la web", () => window.hslLauncher.openMembershipUrl(), { scope: "external" });
    }

    if (action === "open-manual") {
      runAction(action, "Abriendo manual", "Ver manual", () => window.hslLauncher.openManual(), { scope: "external" });
    }

    if (action === "open-ranking") {
      openRankingWithOperationFeedback();
    }

    if (action === "refresh-connectivity") {
      runAction(action, "Comprobando conexi\u00f3n", "Comprobar conexi\u00f3n", async () => {
        const connectivity = await window.hslLauncher.requestConnectivityRefresh("manual");
        const ok = connectivity?.reachability === "connected";
        return {
          action,
          connectivity,
          ok,
          summary: ok ? "Conexi\u00f3n con High Score League confirmada." : "No se pudo conectar con High Score League.",
        };
      }, { restoreTriggerFocus: true });
    }

    if (action === "check-membership") {
      runAction(action, "Comprobando temporada", "Comprobar de nuevo", () => window.hslLauncher.checkMembership());
    }

    if (action === "diagnose") {
      runAction(action, "Creando diagn\u00f3stico", COPY.actions.diagnose, () => window.hslLauncher.diagnose());
    }

    if (action === "play") {
      runAction(action, "Abriendo competición", COPY.actions.play, () => window.hslLauncher.playCompetition(), {
        closingLabel: "Cerrando competición",
        phaseDriven: true,
        runningLabel: "Competición en curso",
        scope: "external",
      });
    }

    if (action === "practice") {
      runAction(action, "Abriendo práctica", COPY.actions.practice, () => window.hslLauncher.practice(), {
        closingLabel: "Cerrando práctica",
        phaseDriven: true,
        runningLabel: "Práctica en curso",
        scope: "external",
      });
    }

    if (action === "force-account-sync") {
      runAction(action, "Sincronizando cuentas", "Forzar sincronizacion", () => window.hslLauncher.forceAccountSync());
    }

    if (action === "force-ranking-refresh") {
      runAction(action, "Comprobando rankings", "Forzar comprobacion de rankings", () => window.hslLauncher.requestRankingCapabilitiesRefresh());
    }

    if (action === "restore-failed") {
      const filename = button.dataset.filename;
      runAction(action, "Restaurando", "Restaurar a pendientes", () => window.hslLauncher.restoreFailed(filename));
    }

    if (action === "remove-known-account") {
      const userId = button.dataset.userId;
      const account = current.data?.accounts?.knownAccounts?.find((item) => item.userId === userId);

      if (userId && !button.disabled) {
        store.setState({
          activeDialog: {
            email: account?.email || "",
            type: "forget-account",
            userId,
          },
        });
      }
    }

    if (action === "confirm-forget-account") {
      const userId = current.activeDialog?.type === "forget-account"
        ? current.activeDialog.userId
        : null;

      if (userId) {
        store.setState({ activeDialog: null });
        runAction("remove-known-account", "Quitando cuenta", "Quitar cuenta", async () => {
          await flushPendingLibraryPreferences();
          return window.hslLauncher.removeKnownAccount(userId);
        });
      }
    }

    if (action === "sync-plugin") {
      runAction(action, "Sincronizando plugin", COPY.actions.syncPlugin, () => window.hslLauncher.syncPlugin());
    }

    if (action === "logout") {
      runAction(action, "Cerrando sesión", COPY.actions.logout, async () => {
        await flushPendingLibraryPreferences();
        return window.hslLauncher.logout();
      });
    }
  });
}

store.subscribe(render);
render();
bindActions();
startupReadiness.mark("shell", "ready");
window.hslLauncher.reportStartupMilestone?.({ name: "shell-mounted", status: "ready" });
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
function handleRendererOffline() {
  window.hslLauncher.requestConnectivityRefresh?.("renderer-offline");
}

function handleRendererOnline() {
  window.hslLauncher.requestConnectivityRefresh?.("renderer-online");
}

function handleConnectionChange() {
  window.hslLauncher.requestConnectivityRefresh?.("connection-change");
}

function cleanupConnectivitySignals() {
  window.removeEventListener("offline", handleRendererOffline);
  window.removeEventListener("online", handleRendererOnline);
  navigator.connection?.removeEventListener?.("change", handleConnectionChange);
}

function cleanupRendererLifecycle() {
  loginDraft.clear();
  busyRunSequence += 1;
  cancelActiveOperationFeedback();
  if (activeBusyPhaseTimer !== null) window.clearTimeout(activeBusyPhaseTimer);
  activeBusyPhaseTimer = null;
  activeRankingFeedback = null;
  cleanupConnectivitySignals();
  metadataResizeObserver?.disconnect();
  window.cancelAnimationFrame(metadataLayoutFrame);
  if (libraryPreferencesPersistTimer) {
    window.clearTimeout(libraryPreferencesPersistTimer);
    libraryPreferencesPersistTimer = null;
  }
  startupAssetSequence += 1;
  startupReadiness.dispose();
  assetPreloader.dispose();
  removeRendererSubscriptions.forEach((remove) => remove?.());
}

window.addEventListener("offline", handleRendererOffline);
window.addEventListener("online", handleRendererOnline);
navigator.connection?.addEventListener?.("change", handleConnectionChange);
window.addEventListener("beforeunload", cleanupRendererLifecycle, { once: true });
const removeRendererSubscriptions = [
  window.hslLauncher.onConnectivityState?.(applyConnectivityState),
  window.hslLauncher.onLauncherState?.(applyBackgroundLauncherState),
  window.hslLauncher.onRankingCapabilitiesState?.(applyRankingCapabilitiesState),
  window.hslLauncher.onBusyPhase?.((phase) => {
    const label = String(phase?.label || "").trim();
    if (label && store.getState().busy) store.setState({ busyLabel: label });
  }),
].filter(Boolean);
window.hslLauncher.getConnectivityState?.().then(applyConnectivityState).catch(() => {});
window.hslLauncher.getRankingCapabilitiesState?.().then(applyRankingCapabilitiesState).catch(() => {});
refreshState().catch((error) => {
  store.setState({
    initialLoadError: "No se pudo leer el estado local inicial. Puedes reintentar desde Biblioteca.",
    logs: appendLog(store.getState().logs, {
      details: [error.message || String(error)],
      ok: false,
      summary: "No se pudo leer el estado local inicial.",
      title: "Carga inicial",
    }),
  });
  startupReadiness.mark("localState", "error");
  startupReadiness.mark("library", "degraded");
  startupReadiness.mark("selection", "degraded");
  startupReadiness.mark("criticalAssets", "fallback");
});
