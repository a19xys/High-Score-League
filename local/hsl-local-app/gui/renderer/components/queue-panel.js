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

function renderFailedItem(item) {
  const score = item.score === null ? "sin puntuacion" : item.score.toLocaleString();
  const title = item.game || item.rom || "Puntuacion local";
  const reason = item.failure?.friendlyReason || "No se pudo enviar esta puntuacion.";
  const technicalReason = item.failure?.technicalReason || item.errors.join("; ") || "Sin detalle tecnico disponible.";

  return `
    <li class="queue-item failed-item">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(score)} · ${escapeHtml(formatDetectedAt(item.detectedAt))}</p>
        <p class="queue-error">${escapeHtml(reason)}</p>
        <details class="technical-details">
          <summary>Ver detalles</summary>
          <dl>
            <div>
              <dt>Archivo</dt>
              <dd>${escapeHtml(item.filename)}</dd>
            </div>
            <div>
              <dt>Motivo tecnico</dt>
              <dd>${escapeHtml(technicalReason)}</dd>
            </div>
          </dl>
        </details>
      </div>
      <button class="tool-button restore-button" type="button" data-action="restore-failed" data-filename="${escapeHtml(item.filename)}">
        Restaurar a pendientes
      </button>
    </li>
  `;
}

function renderFailedSection(failed) {
  if (!failed?.exists || failed.count === 0) {
    return "";
  }

  const countText = failed.count === 1
    ? "1 puntuacion requiere atencion"
    : `${failed.count} puntuaciones requieren atencion`;
  const items = failed.items.slice(0, 5);

  return `
    <section class="attention-section">
      <div class="panel-heading compact">
        <div>
          <h3>Puntuaciones con error</h3>
          <p>${countText}. Tu puntuacion no se ha perdido.</p>
        </div>
        <span class="badge badge-warn">Requieren atencion</span>
      </div>
      <p class="attention-copy">Puedes restaurarlas a pendientes y reintentarlas cuando corrijas el problema.</p>
      <ul class="queue-list">${items.map(renderFailedItem).join("")}</ul>
    </section>
  `;
}

export function renderQueuePanel(state) {
  const pending = state.data?.queue?.pending;
  const failed = state.data?.queue?.failed;

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
      ${renderFailedSection(failed)}
    </section>
  `;
}
