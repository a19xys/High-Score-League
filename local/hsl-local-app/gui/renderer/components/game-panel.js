import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";
import {
  deriveGameSummaryPresentation,
  derivePackPresentation,
  derivePrimaryActions,
} from "../product-presentation.js";
import { renderActivitySummaryCard } from "./queue-panel.js";
import {
  renderAvailabilityButton,
  renderBlockingReasons,
  renderContextNotice,
  renderStatusBadge,
} from "./status-primitives.js";

function renderHeroLogo(game, selection) {
  const logo = game?.assets?.logo || game?.assets?.icon;
  const kind = game?.assets?.logo?.url ? "logo" : "icon";

  if (!logo?.url) {
    return "";
  }

  return `
    <div class="game-hero-logo-safe-area">
      <img class="game-hero__logo" src="${escapeHtml(logo.url)}" alt="" hidden
        data-visual-asset data-asset-scope="detail" data-asset-kind="${kind}"
        data-asset-url="${escapeHtml(logo.url)}" data-asset-selection="${escapeHtml(selection)}"
        data-asset-generation="${escapeHtml(game.visualAssetGeneration || 0)}" data-asset-status="pending">
    </div>
  `;
}

function renderPackVisuals(game, activeSelection) {
  const hero = game?.assets?.hero || game?.assets?.cover;
  const logo = game?.assets?.logo || game?.assets?.icon;
  const heroKind = game?.assets?.hero?.url ? "hero" : "cover";
  const selection = activeSelection || game?.instanceKey || "none";
  const heroClass = [
    "game-hero-stage",
    hero?.url ? "game-hero-stage--image" : "game-hero-stage--fallback",
    logo?.url ? "game-hero-stage--with-logo" : "",
  ].filter(Boolean).join(" ");

  return `
    <div class="${heroClass}" aria-hidden="true" data-asset-container>
      <div class="game-hero-media" data-asset-container>
        <div class="game-panel__placeholder"><span>High Score League</span><strong>HSL</strong></div>
        ${hero?.url ? `
          <img class="game-panel__hero" src="${escapeHtml(hero.url)}" alt="" hidden
            data-visual-asset data-asset-scope="detail" data-asset-kind="${heroKind}"
            data-asset-url="${escapeHtml(hero.url)}" data-asset-selection="${escapeHtml(selection)}"
            data-asset-generation="${escapeHtml(game.visualAssetGeneration || 0)}" data-asset-status="pending">
        ` : ""}
      </div>
      ${renderHeroLogo(game, selection)}
    </div>
  `;
}

function renderPackMetadata(game) {
  const normalizeMetadataValue = (value, { splitCommas = true } = {}) => {
    const values = Array.isArray(value) ? value : [value];
    const seen = new Set();
    const parts = [];

    for (const item of values) {
      const text = String(item ?? "").trim();

      if (!text || /^(undefined|null)$/i.test(text)) {
        continue;
      }

      for (const part of text.split(splitCommas ? /\s*[·,;]\s*/ : /\s*[·;]\s*/)) {
        const normalized = part.trim();
        const key = normalized.toLocaleLowerCase();

        if (!normalized || /^(undefined|null)$/i.test(normalized) || seen.has(key)) {
          continue;
        }

        seen.add(key);
        parts.push(normalized);
      }
    }

    return parts.join(" · ");
  };
  const metadataText = (value) => normalizeMetadataValue(value, { splitCommas: false }) || "Sin datos";
  const items = [
    ["developer", "developer", "Desarrollador", metadataText(game?.developer || game?.publisher)],
    ["year", "year", "Año", metadataText(game?.year)],
    ["genre", "genre", "Género", normalizeMetadataValue(game?.genre) || "Sin datos"],
    ["playtime", "playtime", "Tiempo jugado", metadataText(game?.playTime)],
  ];

  return `
    <div class="game-metadata-grid" aria-label="Metadatos del juego">
      ${items.map(([area, icon, label, value]) => `
        <div class="game-metadata-item game-metadata-item--${escapeHtml(area)}" title="${escapeHtml(label)}: ${escapeHtml(value)}" aria-label="${escapeHtml(label)}: ${escapeHtml(value)}">
          ${renderIcon(icon, { className: "game-metadata-icon" })}
          <span class="game-metadata-copy">
            <span class="game-metadata-label sr-only">${escapeHtml(label)}</span>
            <strong class="game-metadata-value">${escapeHtml(value)}</strong>
          </span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPackErrors(game, readiness, bridge) {
  const pack = derivePackPresentation({ game, readiness, bridge });
  if (!["duplicate", "invalid", "mame-unavailable"].includes(pack.status)) {
    return "";
  }

  return renderContextNotice(pack, { className: "pack-error-panel" });
}

const HSL_FALLBACK_LOGO_URL = "./assets/brand/logo-horizontal.png";

function renderHslFallbackHero() {
  return `
    <div class="game-hero-shell game-hero-shell--brand" aria-hidden="true">
      <div class="game-hero-stage game-hero-stage--fallback game-hero-stage--brand game-hero-stage--with-logo">
        <div class="game-hero-media"></div>
        <div class="game-hero-logo-safe-area">
          <img class="game-hero__logo game-hero__logo--brand" src="${HSL_FALLBACK_LOGO_URL}" alt="" loading="eager" data-hsl-fallback-logo>
        </div>
      </div>
    </div>
  `;
}

function renderBrandedEmptyPanel({ ariaLabel, body, title }) {
  return `
    <section class="game-panel game-detail-card launcher-fallback" aria-label="${escapeHtml(ariaLabel)}">
      ${renderHslFallbackHero()}
      <div class="game-detail-body launcher-fallback__body">
        <div class="launcher-fallback__copy">
          <h2>${escapeHtml(title)}</h2>
          <p class="ready-copy">${escapeHtml(body)}</p>
        </div>
      </div>
    </section>
  `;
}

function renderUnavailableLibraryPanel(directory) {
  const inaccessible = directory?.reason === "inaccessible";
  const body = inaccessible
    ? "No se puede acceder a tu biblioteca de packs. Conecta de nuevo la unidad o cambia la ubicación desde Biblioteca."
    : "No se encuentra tu biblioteca de packs. Conecta de nuevo la unidad o cambia la ubicación desde Biblioteca.";

  return renderBrandedEmptyPanel({
    ariaLabel: "Biblioteca de packs no disponible",
    body,
    title: "Biblioteca no disponible",
  });
}

export function shouldRenderLibraryBrandFallback(state) {
  if (state.libraryActivationInProgress) return null;
  const data = state.data;
  const directory = data?.library?.directory;
  const libraryStatus = data?.library?.status || null;

  if (["missing", "inaccessible"].includes(libraryStatus) || (directory?.configured && !directory.available)) {
    return "unavailable";
  }

  if (libraryStatus === "unconfigured" || (!data?.game && !directory?.configured)) return "unconfigured";
  if (libraryStatus === "available-empty" || (!data?.game && directory?.available && (data?.library?.packs?.length || 0) === 0)) return "empty";

  if (libraryStatus === "available-populated") {
    const activeInstanceKey = data?.selection?.activeInstanceKey || null;
    const activePackExists = activeInstanceKey && data.library.packs.some((pack) => pack.instanceKey === activeInstanceKey);
    if (!data?.game || !activePackExists || data.game.instanceKey !== activeInstanceKey) return "no-selection";
  }

  return null;
}

export function renderGameVisualRegion(state) {
  return renderPackVisuals(state.data?.game, state.data?.selection?.activeInstanceKey);
}

const HERO_PACK_ERROR_IGNORED_CHECK_IDS = new Set([
  "membership",
  "session",
  "scope",
  "web-base-url",
]);

export function deriveGameHeroStatusPresentation(state) {
  const data = state.data || {};
  const game = data.game;

  if (!game) return null;

  const readiness = data.readiness || {};
  const pack = derivePackPresentation({ game, readiness, bridge: data.bridge });
  const summary = deriveGameSummaryPresentation(state);
  const hasCanonicalPackError = ["duplicate", "invalid", "mame-unavailable"].includes(pack.status)
    || ["error", "invalid"].includes(readiness.status)
    || (game.errors || []).length > 0
    || (readiness.checks || []).some((check) => (
      check?.level === "error" && !HERO_PACK_ERROR_IGNORED_CHECK_IDS.has(check.id)
    ));

  if (hasCanonicalPackError) {
    return {
      accessibleLabel: "Pack con errores",
      icon: "error",
      label: "Error",
      severity: "error",
      status: "error",
    };
  }

  if (summary.status === "checking") {
    return {
      accessibleLabel: "Comprobando",
      compact: true,
      icon: "refresh",
      label: "",
      severity: "progress",
      status: "checking",
    };
  }

  if (summary.status === "competition-ready") {
    return {
      accessibleLabel: "Pack listo",
      icon: "check",
      label: "Listo",
      severity: "success",
      status: "ready",
    };
  }

  return null;
}

export function renderGameHeroIndicatorsRegion(state) {
  const favorite = state.data?.game?.favorite === true;
  const packStatus = deriveGameHeroStatusPresentation(state);
  const count = Number(favorite) + Number(Boolean(packStatus));

  if (count === 0) return "";

  return `
    <div class="game-hero-indicators" data-indicator-count="${count}">
      ${favorite ? `
        <span class="game-hero-indicator game-hero-indicator--favorite" role="img" aria-label="Juego favorito" title="Juego favorito">
          ${renderIcon("star-filled", { className: "game-hero-indicator__icon", size: "sm" })}
          <span class="game-hero-indicator__label" aria-hidden="true">Favorito</span>
        </span>
      ` : ""}
      ${packStatus ? `
        <span class="game-hero-indicator game-hero-indicator--status game-hero-indicator--${escapeHtml(packStatus.status)}${packStatus.compact ? " game-hero-indicator--compact" : ""}" role="img" aria-label="${escapeHtml(packStatus.accessibleLabel)}" title="${escapeHtml(packStatus.accessibleLabel)}" data-severity="${escapeHtml(packStatus.severity)}">
          ${renderIcon(packStatus.icon, { className: "game-hero-indicator__icon", size: "sm" })}
          ${packStatus.label ? `<span class="game-hero-indicator__label" aria-hidden="true">${escapeHtml(packStatus.label)}</span>` : ""}
        </span>
      ` : ""}
    </div>
  `;
}

function stateWithMembershipPresentation(state, membership) {
  if (!state.data || membership === state.data.membership) return state;
  return { ...state, data: { ...state.data, membership } };
}

export function renderGameStatusRegion(state, membership = state.data?.membership) {
  const status = deriveGameSummaryPresentation(stateWithMembershipPresentation(state, membership));

  if (["checking", "competition-ready", "duplicate", "invalid", "mame-unavailable"].includes(status.status)) return "";

  return `
    <div class="badge-row">
      ${renderStatusBadge(status)}
    </div>
  `;
}

export function renderGameIdentityRegion(state) {
  const data = state.data || {};
  const game = data.game || {};
  const weekLabel = game.weekNumber ? `Semana ${game.weekNumber}` : game.weekId ? "Semana" : null;
  const description = game.shortDescription || "";

  return `
    <div class="pack-title-row">
      <div class="game-title-block">
        <div class="game-title-main">
          <h2 title="${escapeHtml(game.displayName)}">${escapeHtml(game.displayName)}</h2>
        </div>
        ${weekLabel ? `<p class="game-week-subtitle">${renderIcon("calendar", { className: "status-icon game-week-icon text-companion-icon" })}<span>${escapeHtml(weekLabel)}</span></p>` : ""}
      </div>
    </div>
    ${description ? `<p class="ready-copy">${escapeHtml(description)}</p>` : ""}
    ${renderPackMetadata(game)}
    ${renderPackErrors(game, data.readiness, data.bridge)}
  `;
}

export function renderGameActionsRegion(state) {
  const actions = derivePrimaryActions(state);
  const orderedActions = [actions.competition, actions.practice, actions.manual, actions.ranking];

  return `
    <div class="primary-actions action-grid">
      ${renderAvailabilityButton(actions.competition, { className: "play-button action-tile" })}
      ${renderAvailabilityButton(actions.practice, { className: "secondary-action primary-action-tile action-tile" })}
      ${renderAvailabilityButton(actions.manual, { className: "secondary-action compact-action action-tile" })}
      ${renderAvailabilityButton(actions.ranking, { className: "secondary-action compact-action action-tile" })}
    </div>
    ${renderBlockingReasons(orderedActions)}
  `;
}

export function renderGameActivityRegion(state) {
  return renderActivitySummaryCard(state);
}

export function renderGamePanel(state, membership = state.data?.membership) {
  const data = state.data;

  if (!data) {
    if (state.initialLoadError) {
      return renderBrandedEmptyPanel({
        ariaLabel: "Estado local recuperable",
        body: state.initialLoadError,
        title: "El launcher sigue disponible",
      });
    }
    return `
      <section class="game-panel game-detail-card game-detail-card--empty" aria-busy="${state.busy ? "true" : "false"}">
        <div class="game-hero-stage game-hero-stage--empty" aria-hidden="true"></div>
        <div class="game-detail-body game-detail-body--empty"></div>
      </section>
    `;
  }

  const directory = data.library?.directory;
  const fallbackReason = shouldRenderLibraryBrandFallback(state);

  if (fallbackReason === "unavailable") {
    return renderUnavailableLibraryPanel(directory);
  }

  if (fallbackReason === "unconfigured") {
    return renderBrandedEmptyPanel({
      ariaLabel: "Biblioteca de packs sin configurar",
      body: "Escoge una carpeta para empezar a añadir y jugar tus packs.",
      title: "Configura tu biblioteca",
    });
  }

  if (fallbackReason === "empty") {
    return renderBrandedEmptyPanel({
      ariaLabel: "Biblioteca de packs vacía",
      body: "No hay packs en esta ubicación. Importa un pack o cambia la ubicación de la biblioteca.",
      title: "Tu biblioteca está vacía",
    });
  }

  if (fallbackReason === "no-selection") {
    return renderBrandedEmptyPanel({
      ariaLabel: "Biblioteca sin pack seleccionado",
      body: "Selecciona un pack para ver sus detalles.",
      title: "Elige un juego de tu biblioteca",
    });
  }

  const game = data?.game;

  if (!game) {
    return `
      <section class="game-panel game-detail-card game-detail-card--empty" aria-busy="true">
        <div class="game-hero-stage game-hero-stage--empty" aria-hidden="true"></div>
        <div class="game-detail-body game-detail-body--empty"></div>
      </section>
    `;
  }

  return `
    <section class="game-panel game-detail-card">
      <div class="game-hero-shell">
        <div class="render-region-contents" data-render-region="game-visual">${renderGameVisualRegion(state)}</div>
        <div class="game-hero-indicators-region" data-render-region="game-hero-indicators">${renderGameHeroIndicatorsRegion(state)}</div>
      </div>
      <div class="game-detail-body">
        <div class="render-region-contents" data-render-region="game-status">${renderGameStatusRegion(state, membership)}</div>
        <div class="render-region-contents" data-render-region="game-identity">${renderGameIdentityRegion(state)}</div>
        <div class="render-region-contents" data-render-region="game-actions">${renderGameActionsRegion(state)}</div>
        <div class="render-region-contents" data-render-region="game-activity">${renderGameActivityRegion(state)}</div>
      </div>
    </section>
  `;
}
