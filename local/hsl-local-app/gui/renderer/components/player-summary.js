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
      badge: "Sin cuenta",
      className: "badge badge-warn",
      description: "Conecta tu cuenta desde la CLI para subir puntuaciones.",
      title: "Cuenta pendiente",
    };
  }

  return {
    badge: "Cuenta conectada",
    className: session.status === "warning" ? "badge badge-warn" : "badge badge-ok",
    description: session.status === "warning"
      ? "Sesión local activa, pero conviene renovarla pronto."
      : "Sesión local activa.",
    title: session.email || session.userId || "Jugador conectado",
  };
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
