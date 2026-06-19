import { escapeHtml } from "./html.js";

function formatDetectedAt(value) {
  if (!value) return "sin fecha";
  return new Date(value).toLocaleString();
}

function renderQueueItem(item) {
  const status = item.ok ? "Válida" : "Revisar";
  const score = item.score === null ? "sin puntuación" : item.score.toLocaleString();
  const errorText = item.errors.length > 0 ? `<p class="queue-error">${escapeHtml(item.errors.join("; "))}</p>` : "";

  return `
    <li class="queue-item">
      <div>
        <strong>${escapeHtml(item.game || item.rom || "Puntuación local")}</strong>
        <p>${escapeHtml(score)} · ${escapeHtml(formatDetectedAt(item.detectedAt))}</p>
        ${errorText}
      </div>
      <span class="${item.ok ? "badge badge-ok" : "badge badge-error"}">${status}</span>
    </li>
  `;
}

export function renderQueuePanel(state) {
  const pending = state.data?.queue?.pending;

  if (!pending) {
    return `<section class="panel queue-panel"><h2>Puntuaciones pendientes</h2><p class="muted">Cargando cola local...</p></section>`;
  }

  const items = pending.items.slice(0, 8);
  const body = items.length > 0
    ? `<ul class="queue-list">${items.map(renderQueueItem).join("")}</ul>`
    : `<div class="empty-state">No hay puntuaciones pendientes.</div>`;

  return `
    <section class="panel queue-panel">
      <div class="panel-heading">
        <div>
          <h2>Puntuaciones pendientes</h2>
          <p>Cola de seguridad · ${pending.count} guardadas · ${pending.validCount} válidas</p>
        </div>
        <span class="badge">${pending.exists ? "Cola local" : "No disponible"}</span>
      </div>
      ${body}
    </section>
  `;
}
