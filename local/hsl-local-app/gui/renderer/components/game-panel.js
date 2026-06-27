import { COPY, getReadyLabel } from "./copy.js";
import { escapeHtml } from "./html.js";
import { renderActivitySummaryCard } from "./queue-panel.js";

function membershipBadge(membership) {
  const labels = {
    error: ["badge-warn", "Listo con avisos"],
    invalid_week: ["badge-error", "Pack con errores"],
    member: ["badge-ok", "Participas en la temporada"],
    missing_week: ["badge-error", "Pack con errores"],
    no_session: ["badge-warn", "Sin cuenta"],
    not_member: ["badge-error", "No participas en la temporada"],
    unauthenticated: ["badge-error", "Sin cuenta"],
    unknown: ["badge-warn", "Listo con avisos"],
  };

  if (!membership) {
    return `<span class="badge badge-muted">Listo con avisos</span>`;
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
  const legacy = bridge?.contractStatus === "deprecated" || bridge?.deprecated;

  return [
    `<span class="badge ${classes[status] || classes.unknown}">${labels[status] || labels.unknown}</span>`,
    legacy ? `<span class="badge badge-warn">Legacy</span>` : "",
  ].filter(Boolean).join("");
}

function renderPackLogo(game) {
  const logo = game?.assets?.logo || game?.assets?.icon;

  if (!logo?.url) {
    return "";
  }

  return `
    <img class="pack-logo" src="${escapeHtml(logo.url)}" alt="${escapeHtml(game?.displayName || "Logo del pack")}">
  `;
}

function renderPackVisuals(game) {
  const hero = game?.assets?.hero || game?.assets?.cover;

  if (!hero?.url) {
    return `<div class="game-panel__placeholder" aria-hidden="true"><span>HSL</span></div>`;
  }

  return `<img class="game-panel__hero" src="${escapeHtml(hero.url)}" alt="">`;
}

function renderPackMetadata(game) {
  const items = [
    ["developer", "Desarrollador", game?.developer || game?.publisher],
    ["year", "Año", game?.year ? String(game.year) : null],
    ["genre", "Género", game?.genre?.join(", ")],
    ["time", "Tiempo de juego", game?.playTime],
  ].filter((item) => item[2]);

  if (items.length === 0) {
    return "";
  }

  return `
    <div class="pack-metadata-row">
      ${items.map(([icon, label, value]) => `
        <span class="pack-metadata-item" title="${escapeHtml(label)}: ${escapeHtml(value)}">
          <span class="icon-slot icon-slot--${icon}" aria-hidden="true"></span>
          <span>${escapeHtml(value)}</span>
        </span>
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
      <span class="action-icon icon-slot icon-slot--${icon}" aria-hidden="true"></span>
      <span>${label}</span>
    </button>
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
  const subtitle = game?.subtitle || [game?.seasonName, weekLabel].filter(Boolean).join(" · ");
  const description = game?.shortDescription || getReadyLabel(data);

  return `
    <section class="game-panel">
      ${renderPackVisuals(game)}
      <div class="game-panel__content">
        <div class="badge-row">
          ${readinessBadges(readiness, bridge)}
          ${membershipBadge(membership)}
          ${autoSyncBadge(autoSync)}
        </div>
        <div class="pack-title-row">
          ${renderPackLogo(game)}
          <div class="min-w-0">
            <div class="game-title-line">
              <h2>${escapeHtml(game?.displayName || "Space Invaders")}</h2>
              ${weekLabel ? `<span class="badge badge-muted week-chip"><span class="icon-slot icon-slot--season" aria-hidden="true"></span>${escapeHtml(weekLabel)}</span>` : ""}
            </div>
            ${subtitle ? `<p class="game-week">${escapeHtml(subtitle)}</p>` : ""}
            ${renderPackMetadata(game)}
          </div>
        </div>
        <p class="ready-copy">${escapeHtml(description)}</p>
        <div class="primary-actions action-grid">
          <button class="play-button action-tile" type="button" data-action="play" ${competitionDisabled}>
            <span class="action-icon icon-slot icon-slot--play" aria-hidden="true"></span>
            <span>${COPY.actions.play}</span>
          </button>
          <button class="secondary-action compact-action action-tile" type="button" data-action="practice" ${practiceDisabled}>
            <span class="action-icon icon-slot icon-slot--practice" aria-hidden="true"></span>
            <span>Practicar</span>
          </button>
          ${renderContentAction("open-manual", "Manual", game?.manual, disabled)}
          ${renderContentAction("open-ranking", "Ranking", game?.ranking, disabled)}
        </div>
        ${renderActivitySummaryCard(state)}
      </div>
    </section>
  `;
}
