import { getPackLabel, getQueueSummary } from "./copy.js";
import { escapeHtml } from "./html.js";

function initialsFromSession(session) {
  const value = session?.email || session?.userId || "Jugador";
  return value
    .split(/[@.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase())
    .join("") || "JL";
}

function formatSession(session) {
  if (!session?.hasSession) {
    return {
      badge: "No conectado",
      className: "badge badge-warn",
      description: "Inicia sesión para subir puntuaciones a High Score League.",
      title: "No conectado",
    };
  }

  return {
    badge: "Cuenta conectada",
    className: session.status === "warning" ? "badge badge-warn" : "badge badge-ok",
    description: session.status === "warning"
      ? "Sesión local activa, pero conviene renovarla pronto."
      : "Sesión local activa.",
    title: session.email || "Jugador conectado",
  };
}

function renderAuthControls(state, data) {
  const disabled = state.busy ? "disabled" : "";

  if (data.session?.hasSession) {
    return `
      <div class="account-actions">
        <button class="tool-button" type="button" data-action="logout" ${disabled}>
          Cerrar sesión
        </button>
      </div>
    `;
  }

  if (!state.authFormOpen) {
    return `
      <div class="account-actions">
        <button class="tool-button account-primary" type="button" data-action="show-login" ${disabled}>
          Iniciar sesión
        </button>
      </div>
    `;
  }

  return `
    <form class="auth-form" data-auth-form>
      <div>
        <label for="hsl-login-email">Email</label>
        <input id="hsl-login-email" name="email" type="email" autocomplete="username" required ${disabled}>
      </div>
      <div>
        <label for="hsl-login-password">Contraseña</label>
        <input id="hsl-login-password" name="password" type="password" autocomplete="current-password" required ${disabled}>
      </div>
      ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ""}
      <div class="form-actions">
        <button class="tool-button account-primary" type="submit" ${disabled}>
          ${state.busy && state.busyLabel === "Conectando" ? "Conectando..." : "Entrar"}
        </button>
        <button class="tool-button" type="button" data-action="cancel-login" ${disabled}>
          Cancelar
        </button>
      </div>
    </form>
  `;
}

export function renderPlayerSummary(state) {
  const data = state.data;

  if (!data) {
    return `<section class="panel player-summary skeleton-panel"></section>`;
  }

  const session = formatSession(data.session);
  const totals = data.queue.totals;

  return `
    <section class="panel player-summary">
      <div class="summary-account">
        <div class="avatar">${escapeHtml(initialsFromSession(data.session))}</div>
        <div class="min-w-0">
          <span class="${session.className}">${session.badge}</span>
          <h2>${escapeHtml(session.title)}</h2>
          <p>${escapeHtml(session.description)}</p>
        </div>
      </div>

      ${renderAuthControls(state, data)}

      <div class="summary-list">
        <div class="summary-row">
          <span>Puntuaciones pendientes</span>
          <strong>${totals.pending}</strong>
        </div>
        <div class="summary-row">
          <span>Enviadas</span>
          <strong>${totals.sent}</strong>
        </div>
        <div class="summary-row">
          <span>Revisar</span>
          <strong>${totals.failed}</strong>
        </div>
      </div>

      <div class="soft-note">
        <strong>${escapeHtml(getPackLabel(data.bridge))}</strong>
        <p>${escapeHtml(getQueueSummary(data.queue))}</p>
      </div>
    </section>
  `;
}
