import { COPY, getPackLabel, getQueueSummary, getReadyLabel } from "./copy.js";
import { escapeHtml } from "./html.js";

function renderSubmitState(state) {
  const pending = state.data?.queue?.totals?.pending || 0;
  const hasSession = Boolean(state.data?.session?.hasSession);
  const disabled = state.busy || pending === 0 || !hasSession ? "disabled" : "";

  if (!hasSession) {
    return `
      <button class="secondary-action" type="button" data-action="submit" disabled>
        <span>${pending > 0 ? "Subir pendientes" : "Sin pendientes"}</span>
        <small>Inicia sesión para subir puntuaciones.</small>
      </button>
    `;
  }

  return `
    <button class="secondary-action" type="button" data-action="submit" ${disabled}>
      <span>${pending > 0 ? "Subir pendientes" : "Sin pendientes"}</span>
      <small>${pending > 0 ? getQueueSummary(state.data.queue) : "La cola local está limpia"}</small>
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

export function renderGamePanel(state) {
  const data = state.data;
  const game = data?.game;
  const bridge = data?.bridge;
  const disabled = state.busy ? "disabled" : "";
  const week = game?.weekId || "Semana actual";

  return `
    <section class="game-panel">
      <div class="game-panel__content">
        <div class="badge-row">
          <span class="badge badge-accent">Competición</span>
          <span class="badge badge-ok">Activa</span>
          ${bridge?.packOpened ? `<span class="badge badge-accent">Pack abierto</span>` : ""}
          ${bridge?.packRemembered ? `<span class="badge badge-muted">Último pack cargado</span>` : ""}
          ${bridge?.devBridge ? `<span class="badge badge-muted">Solo desarrollo</span>` : ""}
        </div>
        <div>
          <p class="eyebrow">${escapeHtml(getPackLabel(bridge))}</p>
          <h2>${escapeHtml(game?.displayName || "Space Invaders")}</h2>
          <p class="game-week">${escapeHtml(week)}</p>
        </div>
        <p class="ready-copy">${escapeHtml(getReadyLabel(data))}</p>
        <div class="primary-actions">
          <button class="play-button" type="button" data-action="play" ${disabled}>
            <span>${COPY.actions.play}</span>
            <small>Inicia MAME en modo liga y registra tus intentos.</small>
          </button>
          <div class="support-actions">
            <button class="secondary-action" type="button" data-action="practice" ${disabled}>
              <span>Practicar</span>
              <small>Entrena sin activar el plugin de puntuación.</small>
            </button>
            ${renderSubmitState(state)}
            ${renderPackAction(state)}
          </div>
        </div>
      </div>
      <div class="game-panel__score">
        <span class="score-label">Cola local</span>
        <strong>${data?.queue?.totals?.pending || 0}</strong>
        <span>${(data?.queue?.totals?.pending || 0) === 1 ? "puntuación" : "puntuaciones"}</span>
      </div>
    </section>
  `;
}
