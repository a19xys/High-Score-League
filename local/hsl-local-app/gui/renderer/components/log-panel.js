import { escapeHtml } from "./html.js";

function renderLogEntry(entry) {
  const lines = entry.lines?.length ? entry.lines : ["Sin salida de consola."];
  const statusClass = entry.ok ? "badge badge-ok" : "badge badge-error";

  return `
    <article class="log-entry">
      <div class="panel-row">
        <strong>${escapeHtml(entry.title)}</strong>
        <span class="${statusClass}">${entry.ok ? "OK" : "Atencion"}</span>
      </div>
      <pre>${escapeHtml(lines.map((line) => String(line)).join("\n"))}</pre>
    </article>
  `;
}

export function renderLogPanel(state) {
  const body = state.logs.length > 0
    ? state.logs.map(renderLogEntry).join("")
    : `<div class="empty-state">Los resultados de diagnostico, juego y subida apareceran aqui.</div>`;

  return `
    <section class="panel log-panel">
      <div class="panel-heading">
        <div>
          <h2>Mensajes</h2>
          <p>Salida resumida de las acciones.</p>
        </div>
      </div>
      <div class="log-list">${body}</div>
    </section>
  `;
}
