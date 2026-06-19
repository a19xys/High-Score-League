import { escapeHtml } from "./html.js";

function renderLogEntry(entry) {
  const details = entry.details?.length ? entry.details : ["Sin detalles técnicos."];
  const statusClass = entry.ok ? "badge badge-ok" : "badge badge-error";

  return `
    <article class="log-entry">
      <div class="panel-row">
        <strong>${escapeHtml(entry.title)}</strong>
        <span class="${statusClass}">${entry.ok ? "OK" : "Atención"}</span>
      </div>
      <p>${escapeHtml(entry.summary || "Acción registrada.")}</p>
      <details class="log-details">
        <summary>Ver detalles técnicos</summary>
        <pre>${escapeHtml(details.map((line) => String(line)).join("\n"))}</pre>
      </details>
    </article>
  `;
}

export function renderLogPanel(state) {
  const body = state.logs.length > 0
    ? state.logs.map(renderLogEntry).join("")
    : `<div class="empty-state">Los mensajes de juego, subida y diagnóstico aparecerán aquí.</div>`;

  return `
    <section class="panel log-panel">
      <div class="panel-heading">
        <div>
          <h2>Mensajes</h2>
          <p>Resumen claro primero; detalles técnicos solo si los necesitas.</p>
        </div>
      </div>
      <div class="log-list">${body}</div>
    </section>
  `;
}
