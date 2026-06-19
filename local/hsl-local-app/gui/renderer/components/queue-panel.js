import { escapeHtml } from "./html.js";

function renderQueueItem(item) {
  const status = item.ok ? "Valido" : "Revisar";
  const score = item.score === null ? "sin score" : item.score.toLocaleString();
  const errorText = item.errors.length > 0 ? `<p class="queue-error">${escapeHtml(item.errors.join("; "))}</p>` : "";

  return `
    <li class="queue-item">
      <div>
        <strong>${escapeHtml(item.filename)}</strong>
        <p>${escapeHtml(item.game || item.rom || "Evento local")} · ${escapeHtml(score)}</p>
        ${errorText}
      </div>
      <span class="${item.ok ? "badge badge-ok" : "badge badge-error"}">${status}</span>
    </li>
  `;
}

export function renderQueuePanel(state) {
  const pending = state.data?.queue?.pending;

  if (!pending) {
    return `<section class="panel queue-panel"><h2>Pending</h2><p class="muted">Cargando cola...</p></section>`;
  }

  const items = pending.items.slice(0, 8);
  const body = items.length > 0
    ? `<ul class="queue-list">${items.map(renderQueueItem).join("")}</ul>`
    : `<div class="empty-state">No hay eventos pendientes.</div>`;

  return `
    <section class="panel queue-panel">
      <div class="panel-heading">
        <div>
          <h2>Eventos pending</h2>
          <p>${pending.count} archivos · ${pending.validCount} validos</p>
        </div>
        <span class="badge">${pending.exists ? "Directorio listo" : "No disponible"}</span>
      </div>
      ${body}
    </section>
  `;
}
