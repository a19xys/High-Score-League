import { escapeHtml } from "./html.js";

function badgeClass(status) {
  if (status === "ok") return "badge badge-ok";
  if (status === "warning") return "badge badge-warn";
  if (status === "error") return "badge badge-error";
  return "badge";
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  return new Date(value).toLocaleString();
}

export function renderStatusGrid(state) {
  const data = state.data;

  if (!data) {
    return `
      <section class="status-grid">
        <article class="panel skeleton-panel"></article>
        <article class="panel skeleton-panel"></article>
        <article class="panel skeleton-panel"></article>
      </section>
    `;
  }

  const session = data.session;
  const bridge = data.bridge;
  const game = data.game;
  const pending = data.queue.totals.pending;

  return `
    <section class="status-grid">
      <article class="panel status-card">
        <div class="panel-row">
          <span class="${badgeClass(session.status)}">${session.hasSession ? "Sesion" : "Sin sesion"}</span>
          <span class="muted">Auth local</span>
        </div>
        <h2>${escapeHtml(session.email || session.userId || "Jugador local")}</h2>
        <p>${escapeHtml(session.message)}</p>
        <p class="meta-line">${escapeHtml(session.sessionFile)}</p>
      </article>

      <article class="panel status-card">
        <div class="panel-row">
          <span class="badge badge-accent">${bridge.devBridge ? "Dev bridge" : bridge.mode}</span>
          <span class="muted">${escapeHtml(bridge.configSource)}</span>
        </div>
        <h2>${escapeHtml(game.displayName)}</h2>
        <p>ROM ${escapeHtml(game.rom)} · Week ${escapeHtml(game.weekId || "sin week")}</p>
        <p class="meta-line">${escapeHtml(bridge.workingDir || bridge.packPath || "Rutas por defecto")}</p>
      </article>

      <article class="panel status-card">
        <div class="panel-row">
          <span class="${pending > 0 ? "badge badge-warn" : "badge badge-ok"}">${pending} pending</span>
          <span class="muted">Cola local</span>
        </div>
        <h2>${data.queue.totals.sent} sent · ${data.queue.totals.failed} failed</h2>
        <p>Ultima lectura: ${escapeHtml(formatDate(data.timestamp))}</p>
        <p class="meta-line">${escapeHtml(data.queue.pending.dir)}</p>
      </article>
    </section>
  `;
}
