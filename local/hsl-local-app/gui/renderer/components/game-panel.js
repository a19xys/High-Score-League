import { COPY, getPackLabel, getQueueSummary, getReadyLabel } from "./copy.js";
import { escapeHtml } from "./html.js";

function renderSubmitState(state) {
  const pending = state.data?.queue?.totals?.pending || 0;
  const hasSession = Boolean(state.data?.session?.hasSession);
  const membership = state.data?.membership;
  const autoSyncing = state.data?.autoSync?.status === "syncing";
  const disabled = state.busy || autoSyncing || pending === 0 || !hasSession || membership?.canSubmit === false ? "disabled" : "";

  if (autoSyncing) {
    return `
      <button class="secondary-action" type="button" data-action="submit" disabled>
        <span>Subir pendientes</span>
        <small>Sincronizacion automatica en curso.</small>
      </button>
    `;
  }

  if (!hasSession) {
    return `
      <button class="secondary-action" type="button" data-action="submit" disabled>
        <span>${pending > 0 ? "Subir pendientes" : "Sin pendientes"}</span>
        <small>Inicia sesion para subir puntuaciones.</small>
      </button>
    `;
  }

  if (membership?.canSubmit === false && pending > 0) {
    return `
      <button class="secondary-action" type="button" data-action="submit" disabled>
        <span>Subir pendientes</span>
        <small>${escapeHtml(membership.message || "No se puede subir hasta comprobar la temporada.")}</small>
      </button>
    `;
  }

  return `
    <button class="secondary-action" type="button" data-action="submit" ${disabled}>
      <span>${pending > 0 ? "Subir pendientes" : "Sin pendientes"}</span>
      <small>${pending > 0 ? getQueueSummary(state.data.queue) : "La cola local esta limpia"}</small>
    </button>
  `;
}

function renderPackAction(state) {
  const label = state.data?.bridge?.packOpened ? "Cambiar pack" : "Abrir pack";
  const disabled = state.busy ? "disabled" : "";

  return `
    <button class="secondary-action pack-action" type="button" data-action="open-pack" ${disabled}>
      <span>${label}</span>
      <small>Elige la carpeta raíz del pack descargado.</small>
    </button>
  `;
}

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

export function renderGamePanel(state) {
  const data = state.data;
  const game = data?.game;
  const bridge = data?.bridge;
  const membership = data?.membership;
  const autoSync = data?.autoSync;
  const disabled = state.busy ? "disabled" : "";
  const membershipBlocksCompetition = membership?.canPlayCompetition === false;
  const competitionDisabled = state.busy || !data?.session?.hasSession || membershipBlocksCompetition ? "disabled" : "";
  const competitionHint = membership?.message || (data?.session?.hasSession
    ? "Inicia MAME en modo liga y registra tus intentos."
    : "Inicia sesion para competir y guardar en tu cola local.");
  const week = game?.weekId || "Semana actual";
  const subtitle = game?.subtitle || week;
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
        ${autoSync?.message ? `<p class="sync-copy">${escapeHtml(autoSync.message)}</p>` : ""}
        <div class="primary-actions">
          <button class="play-button" type="button" data-action="play" ${competitionDisabled}>
            <span>${COPY.actions.play}</span>
            <small>${escapeHtml(competitionHint)}</small>
          </button>
          <div class="support-actions">
            <button class="secondary-action" type="button" data-action="practice" ${disabled}>
              <span>Practicar</span>
              <small>Entrena sin activar el plugin de puntuación.</small>
            </button>
            ${renderSubmitState(state)}
            ${renderPackAction(state)}
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
