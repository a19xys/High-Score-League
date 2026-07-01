import { COPY } from "./copy.js";
import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";
import { renderActivitySummaryCard } from "./queue-panel.js";

function membershipBadge(membership) {
  const labels = {
    error: ["badge-warn", "Listo con avisos"],
    invalid_week: ["badge-error", "Pack con errores"],
    member: ["badge-ok", "Participas en la temporada"],
    missing_week: ["badge-error", "Pack con errores"],
    not_member: ["badge-error", "No participas en la temporada"],
    unknown: ["badge-warn", "Listo con avisos"],
  };

  if (!membership || membership.status === "no_session" || membership.status === "unauthenticated") {
    return "";
  }

  const [badgeClass, label] = labels[membership.status] || labels.unknown;

  return `<span class="badge ${badgeClass}">${label}</span>`;
}

function autoSyncBadge(autoSync) {
  const labels = {
    blocked: ["badge-warn", "Pendiente de sincronizar"],
    failed: ["badge-error", "Pendiente de sincronizar"],
    idle: ["badge-ok", "Auto-sync activo"],
    not_eligible: ["badge-muted", "Auto-sync activo"],
    partial_failed: ["badge-warn", "Pendiente de sincronizar"],
    synced: ["badge-ok", "Sincronizado"],
    syncing: ["badge-accent", "Auto-sync activo"],
  };
  const [badgeClass, label] = labels[autoSync?.status] || labels.idle;

  return `<span class="badge ${badgeClass}">${label}</span>`;
}

function readinessBadges(readiness, bridge) {
  const legacy = bridge?.contractStatus === "deprecated" || bridge?.deprecated;
  const classes = {
    blocked: "badge-error",
    ready: "badge-ok",
    unknown: "badge-muted",
    warning: "badge-warn",
  };
  const labels = {
    blocked: "Pack con errores",
    ready: "Pack listo",
    unknown: "Listo con avisos",
    warning: "Listo con avisos",
  };
  const status = readiness?.status || "unknown";
  const displayStatus = legacy && status === "ready" ? "warning" : status;

  return [
    `<span class="badge ${classes[displayStatus] || classes.unknown}">${labels[displayStatus] || labels.unknown}</span>`,
    legacy ? `<span class="badge badge-warn">Legacy</span>` : "",
  ].filter(Boolean);
}

function renderStatusBadges(readiness, membership, autoSync, bridge) {
  return [
    ...readinessBadges(readiness, bridge),
    membershipBadge(membership),
    autoSyncBadge(autoSync),
  ]
    .filter(Boolean)
    .slice(0, 4)
    .join("");
}

function renderHeroLogo(game) {
  const logo = game?.assets?.logo || game?.assets?.icon;

  if (!logo?.url) {
    return "";
  }

  return `
    <img class="game-hero__logo" src="${escapeHtml(logo.url)}" alt="">
  `;
}

function renderPackVisuals(game) {
  const hero = game?.assets?.hero || game?.assets?.cover;
  const logo = game?.assets?.logo || game?.assets?.icon;
  const heroClass = [
    "game-hero-stage",
    hero?.url ? "game-hero-stage--image" : "game-hero-stage--fallback",
    logo?.url ? "game-hero-stage--with-logo" : "",
  ].filter(Boolean).join(" ");

  return `
    <div class="${heroClass}" aria-hidden="true">
      <div class="game-hero-media">
        ${hero?.url
          ? `<img class="game-panel__hero" src="${escapeHtml(hero.url)}" alt="">`
          : `<div class="game-panel__placeholder"><span>High Score League</span><strong>HSL</strong></div>`}
        ${renderHeroLogo(game)}
      </div>
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

function renderContentAction(action, label, content, disabled) {
  const unavailable = !content?.available;
  const icon = action === "open-manual" ? "manual" : "ranking";
  const title = unavailable ? content?.reason || `${label} no disponible para este pack.` : label;

  return `
    <button class="secondary-action compact-action action-tile" type="button" data-action="${action}" title="${escapeHtml(title)}" ${disabled || unavailable ? "disabled" : ""}>
      ${renderIcon(icon, { className: `action-icon icon-slot icon-slot--${icon}` })}
      <span class="action-button-label">${label}</span>
    </button>
  `;
}

function renderDetailFavoriteMark(game) {
  const favorite = Boolean(game?.favorite);

  if (!favorite) {
    return "";
  }

  return `
    <span class="game-favorite-mark game-favorite-mark--active" role="img" aria-label="Juego favorito" title="Juego favorito">
      ${renderIcon("star-filled", { className: "game-favorite-mark__icon", size: "sm" })}
    </span>
  `;
}

function renderPackErrors(game, readiness) {
  const errors = [
    ...(game?.errors || []),
    ...(readiness?.blockers || []),
  ].filter(Boolean);
  const uniqueErrors = [...new Set(errors)];
  const duplicatePaths = game?.duplicatePaths || [];

  if (uniqueErrors.length === 0 && duplicatePaths.length === 0) {
    return "";
  }

  const title = game?.duplicateGroup ? "Pack duplicado" : "Este pack tiene errores";
  const intro = game?.duplicateGroup && duplicatePaths.length > 0
    ? `Se han encontrado ${duplicatePaths.length} carpetas con el mismo packId:`
    : "Corrige estos puntos antes de jugar:";

  return `
    <section class="pack-error-panel" aria-label="${escapeHtml(title)}">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(intro)}</p>
      ${duplicatePaths.length > 0
        ? `<ul class="pack-error-paths">${duplicatePaths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : ""}
      ${uniqueErrors.length > 0
        ? `<ul class="pack-error-list">${uniqueErrors.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : ""}
      ${game?.duplicateGroup
        ? `<p>El launcher no puede decidir cual usar. Elimina las copias o cambia el packId de los packs duplicados.</p>`
        : ""}
    </section>
  `;
}

export function renderGamePanel(state) {
  const data = state.data;
  const game = data?.game;
  const bridge = data?.bridge;
  const membership = data?.membership;
  const autoSync = data?.autoSync;
  const readiness = data?.readiness;
  const disabled = state.busy ? "disabled" : "";
  const membershipBlocksCompetition = membership?.canPlayCompetition === false;
  const readinessBlocksCompetition = readiness?.canPlayCompetition === false;
  const practiceDisabled = state.busy || readiness?.canPractice === false ? "disabled" : "";
  const competitionDisabled = state.busy || !data?.session?.hasSession || membershipBlocksCompetition || readinessBlocksCompetition ? "disabled" : "";
  const weekLabel = game?.weekNumber ? `Semana ${game.weekNumber}` : game?.weekId ? "Semana" : null;
  const description = game?.shortDescription || "";

  return `
    <section class="game-panel game-detail-card">
      ${renderPackVisuals(game)}
      <div class="game-detail-body">
        <div class="badge-row">
          ${renderStatusBadges(readiness, membership, autoSync, bridge)}
        </div>
        <div class="pack-title-row">
          <div class="game-title-block">
            <div class="game-title-main">
              <h2 title="${escapeHtml(game?.displayName || "Space Invaders")}">${escapeHtml(game?.displayName || "Space Invaders")}</h2>
              ${renderDetailFavoriteMark(game)}
            </div>
            ${weekLabel ? `<p class="game-week-subtitle">${renderIcon("calendar", { className: "status-icon game-week-icon", size: "sm" })}<span>${escapeHtml(weekLabel)}</span></p>` : ""}
          </div>
        </div>
        ${description ? `<p class="ready-copy">${escapeHtml(description)}</p>` : ""}
        ${renderPackMetadata(game)}
        ${renderPackErrors(game, readiness)}
        <div class="primary-actions action-grid">
          <button class="play-button action-tile" type="button" data-action="play" ${competitionDisabled}>
            ${renderIcon("play", { className: "action-icon icon-slot icon-slot--play" })}
            <span class="action-button-label">${COPY.actions.play}</span>
          </button>
          <button class="secondary-action primary-action-tile action-tile" type="button" data-action="practice" ${practiceDisabled}>
            ${renderIcon("practice", { className: "action-icon icon-slot icon-slot--practice" })}
            <span class="action-button-label">Practicar</span>
          </button>
          ${renderContentAction("open-manual", "Manual", game?.manual, disabled)}
          ${renderContentAction("open-ranking", "Ranking", game?.ranking, disabled)}
        </div>
        ${renderActivitySummaryCard(state)}
      </div>
    </section>
  `;
}
