import { COPY, getPackLabel, getQueueSummary, getReadyLabel } from "./copy.js";
import { escapeHtml } from "./html.js";

function membershipBadge(membership) {
  const labels = {
    error: ["badge-error", "Error de comprobacion"],
    invalid_week: ["badge-error", "Semana no valida"],
    member: ["badge-ok", "Participas"],
    missing_week: ["badge-error", "Falta weekId"],
    no_session: ["badge-warn", "Sin cuenta"],
    not_member: ["badge-error", "No participas"],
    unauthenticated: ["badge-error", "Sesion no valida"],
    unknown: ["badge-warn", "No se pudo comprobar"],
  };

  if (!membership) {
    return `<span class="badge badge-muted">Participacion pendiente</span>`;
  }

  const [badgeClass, label] = labels[membership.status] || labels.unknown;

  return `<span class="badge ${badgeClass}">${label}</span>`;
}

function autoSyncBadge(autoSync) {
  const labels = {
    blocked: ["badge-warn", "Pendiente de sincronizar"],
    failed: ["badge-error", "No se pudo sincronizar"],
    idle: ["badge-muted", "Auto-sync listo"],
    not_eligible: ["badge-muted", "Sin pendientes"],
    partial_failed: ["badge-warn", "Requiere atencion"],
    synced: ["badge-ok", "Sincronizado"],
    syncing: ["badge-accent", "Sincronizando"],
  };
  const [badgeClass, label] = labels[autoSync?.status] || labels.idle;

  return `<span class="badge ${badgeClass}">${label}</span>`;
}

function renderMembershipCallToAction(membership) {
  if (!membership?.joinUrl || membership.status === "member") {
    return "";
  }

  const label = membership.status === "not_member" ? "Unirse desde la web" : "Abrir temporada en la web";

  return `
    <button class="secondary-action" type="button" data-action="open-membership-url">
      <span>${label}</span>
      <small>Abre High Score League en el navegador.</small>
    </button>
  `;
}

function readinessBadge(status) {
  const classes = {
    blocked: "badge-error",
    ready: "badge-ok",
    unknown: "badge-muted",
    warning: "badge-warn",
  };

  return `<span class="badge ${classes[status] || classes.unknown}">${escapeHtml(status || "unknown")}</span>`;
}

function renderReadinessSummary(readiness) {
  if (!readiness) {
    return "";
  }

  const messages = [
    readiness.message,
    ...(readiness.warnings || []).slice(0, 2),
  ].filter(Boolean).slice(0, 3);

  return `
    <div class="readiness-card readiness-card--${escapeHtml(readiness.status)}">
      <div class="readiness-card__header">
        <span>Estado del pack</span>
        ${readinessBadge(readiness.status)}
      </div>
      <strong>${escapeHtml(readiness.title)}</strong>
      <ul>
        ${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderMembershipCheckAction(state) {
  const disabled = state.busy ? "disabled" : "";

  return `
    <button class="secondary-action" type="button" data-action="check-membership" ${disabled}>
      <span>Comprobar de nuevo</span>
      <small>Actualiza la participacion del pack activo.</small>
    </button>
  `;
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
    return "";
  }

  return `<img class="game-panel__hero" src="${escapeHtml(hero.url)}" alt="">`;
}

function renderPackCredits(game) {
  const credits = [
    game?.developer,
    game?.publisher && game.publisher !== game.developer ? game.publisher : null,
    game?.year ? String(game.year) : null,
    ...(game?.genre || []),
  ].filter(Boolean);

  if (credits.length === 0) {
    return "";
  }

  return `<p class="pack-credits">${escapeHtml(credits.join(" · "))}</p>`;
}

function renderContentAction(action, label, content, disabled) {
  const unavailable = !content?.available;
  const hint = unavailable
    ? content?.reason || `${label} no disponible para este pack.`
    : content.kind === "local"
      ? "Abre el contenido local incluido en el pack."
      : "Abre High Score League en el navegador.";

  return `
    <button class="secondary-action compact-action" type="button" data-action="${action}" ${disabled || unavailable ? "disabled" : ""}>
      <span>${label}</span>
      <small>${escapeHtml(hint)}</small>
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
  const competitionHint = readinessBlocksCompetition
    ? readiness?.message || "El pack necesita atencion antes de competir."
    : membership?.message || (data?.session?.hasSession
    ? "Inicia MAME en modo liga y registra tus intentos."
    : "Inicia sesion para competir y guardar en tu cola local.");
  const practiceHint = readiness?.canPractice === false
    ? readiness.message || "Revisa MAME y la ROM antes de practicar."
    : "Entrena sin activar el plugin de puntuacion.";
  const week = game?.weekId || "Semana actual";
  const season = game?.seasonName || null;
  const subtitle = game?.subtitle || [season, game?.weekNumber ? `Semana ${game.weekNumber}` : week].filter(Boolean).join(" · ");
  const description = game?.shortDescription || getReadyLabel(data);
  const cover = game?.assets?.cover;
  const icon = game?.assets?.icon;

  return `
    <section class="game-panel">
      ${renderPackVisuals(game)}
      <div class="game-panel__content">
        <div class="badge-row">
          <span class="badge badge-accent">Competición</span>
          ${membershipBadge(membership)}
          ${autoSyncBadge(autoSync)}
          ${bridge?.packOpened ? `<span class="badge badge-accent">Pack abierto</span>` : ""}
          ${bridge?.packRemembered ? `<span class="badge badge-muted">Último pack cargado</span>` : ""}
          ${bridge?.scopedQueue ? `<span class="badge badge-ok">Cola cuenta + pack</span>` : ""}
          ${bridge?.devBridge ? `<span class="badge badge-muted">Solo desarrollo</span>` : ""}
        </div>
        <div>
          <p class="eyebrow">${escapeHtml(getPackLabel(bridge))}</p>
          <div class="pack-title-row">
            ${renderPackLogo(game)}
            <div class="min-w-0">
              <h2>${escapeHtml(game?.displayName || "Space Invaders")}</h2>
              <p class="game-week">${escapeHtml(subtitle)}</p>
              ${renderPackCredits(game)}
            </div>
          </div>
        </div>
        <p class="ready-copy">${escapeHtml(description)}</p>
        ${renderReadinessSummary(readiness)}
        ${autoSync?.message ? `<p class="sync-copy">${escapeHtml(autoSync.message)}</p>` : ""}
        <div class="primary-actions">
          <button class="play-button" type="button" data-action="play" ${competitionDisabled}>
            <span>${COPY.actions.play}</span>
            <small>${escapeHtml(competitionHint)}</small>
          </button>
          <div class="support-actions">
            <button class="secondary-action" type="button" data-action="practice" ${practiceDisabled}>
              <span>Practicar</span>
              <small>${escapeHtml(practiceHint)}</small>
            </button>
            ${renderContentAction("open-manual", "Ver manual", game?.manual, disabled)}
            ${renderContentAction("open-ranking", "Ver ranking", game?.ranking, disabled)}
            ${renderMembershipCheckAction(state)}
            ${renderMembershipCallToAction(membership)}
          </div>
        </div>
      </div>
      <div class="game-panel__score">
        ${cover?.url ? `<img class="pack-cover" src="${escapeHtml(cover.url)}" alt="${escapeHtml(game?.displayName || "Portada del pack")}">` : ""}
        ${!cover?.url && icon?.url ? `<img class="pack-icon" src="${escapeHtml(icon.url)}" alt="${escapeHtml(game?.displayName || "Icono del pack")}">` : ""}
        <span class="score-label">Cola local</span>
        <strong>${data?.queue?.totals?.pending || 0}</strong>
        <span>${(data?.queue?.totals?.pending || 0) === 1 ? "puntuación" : "puntuaciones"}</span>
      </div>
    </section>
  `;
}
