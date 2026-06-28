import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";

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
  const score = item.score === null ? "sin puntuación" : item.score.toLocaleString();
  const title = item.game || item.rom || "Puntuación local";
  const reason = item.failure?.friendlyReason || "No se pudo enviar esta puntuación.";
  const technicalReason = item.failure?.technicalReason || item.errors.join("; ") || "Sin detalle técnico disponible.";

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
              <dt>Motivo técnico</dt>
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
    ? "1 puntuación requiere atención"
    : `${failed.count} puntuaciones requieren atención`;
  const items = failed.items.slice(0, 5);

  return `
    <section class="attention-section">
      <div class="panel-heading compact">
        <div>
          <h3>Puntuaciones con error</h3>
          <p>${countText}. Tu puntuación no se ha perdido.</p>
        </div>
        <span class="badge badge-warn">Requieren atención</span>
      </div>
      <p class="attention-copy">Puedes restaurarlas a pendientes y reintentarlas cuando corrijas el problema.</p>
      <ul class="queue-list">${items.map(renderFailedItem).join("")}</ul>
    </section>
  `;
}

export function renderQueuePanel(state) {
  const pending = state.data?.queue?.pending;

  if (!pending) {
    return `<section class="panel queue-panel"><h2>Puntuaciones pendientes</h2><p class="muted">Cargando cola local...</p></section>`;
  }

  const totals = state.data?.queue?.totals || { failed: 0, pending: 0, sent: 0 };
  const autoSync = state.data?.autoSync || {};
  const statusLabel = autoSync.status === "syncing"
    ? "Sincronizando"
    : autoSync.status === "synced"
      ? "Sincronizado"
      : totals.failed > 0
        ? "Requiere atención"
        : totals.pending > 0
          ? "Pendiente de sincronizar"
          : "Auto-sync listo";
  const badgeClass = autoSync.status === "synced"
    ? "badge-ok"
    : autoSync.status === "failed" || totals.failed > 0
      ? "badge-error"
      : totals.pending > 0
        ? "badge-warn"
        : "badge-muted";

  return `
    <section class="panel queue-panel activity-panel">
      <div class="panel-heading compact">
        <div>
          <h2>Actividad local</h2>
          <p>${escapeHtml(autoSync.message || "Las puntuaciones se guardan por cuenta y pack.")}</p>
        </div>
        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
      </div>
      <p class="activity-summary-line">
        ${escapeHtml(getActivitySummary(state.data?.queue, autoSync).message)}
      </p>
      <button class="tool-button activity-details-button" type="button" data-action="show-activity-details">
        Ver detalles
        <small>Cola activa</small>
      </button>
    </section>
  `;
}

export function getActivitySummary(queue, autoSync = {}) {
  const totals = queue?.totals || { failed: 0, pending: 0, sent: 0 };

  if (totals.failed > 0 || autoSync.status === "partial_failed" || autoSync.status === "failed") {
    return {
      icon: "sync-error",
      status: "Requiere atención",
      tone: "warning",
      message: "Hay puntuaciones con error.",
    };
  }

  if (totals.pending > 0 || autoSync.status === "blocked" || autoSync.status === "syncing") {
    return {
      icon: "sync-pending",
      status: autoSync.status === "syncing" ? "Sincronizando" : "Pendiente de sincronizar",
      tone: "pending",
      message: "Quedan puntuaciones por subir.",
    };
  }

  return {
    icon: "sync-ok",
    status: "Sincronizado",
    tone: "ok",
    message: "Todo al día, sin puntuaciones pendientes.",
  };
}

export function renderActivitySummaryCard(state) {
  const summary = getActivitySummary(state.data?.queue, state.data?.autoSync);

  return `
    <section class="activity-summary-card activity-summary-card--${summary.tone}">
      <div class="activity-summary-card__icon" aria-hidden="true">${renderIcon(summary.icon, { className: `status-icon icon-slot icon-slot--${summary.icon}` })}</div>
      <div class="activity-summary-card__copy min-w-0">
        <span class="activity-summary-card__label">Actividad local</span>
        <strong>${escapeHtml(summary.status)}</strong>
        <p>${escapeHtml(summary.message)}</p>
      </div>
      <button class="activity-details-button activity-summary-card__details" type="button" data-action="show-activity-details">
        <span>Ver detalles</span>
        ${renderIcon("chevron-right", { className: "details-chevron", size: "sm" })}
      </button>
    </section>
  `;
}

export function renderActivityDrawer(state) {
  const pending = state.data?.queue?.pending;
  const failed = state.data?.queue?.failed;
  const sent = state.data?.queue?.sent;
  const scoped = Boolean(state.data?.scope);
  const totals = state.data?.queue?.totals || { failed: 0, pending: 0, sent: 0 };
  const autoSync = state.data?.autoSync || {};
  const items = pending?.items?.slice(0, 8) || [];
  const body = items.length > 0
    ? `<ul class="queue-list">${items.map(renderQueueItem).join("")}</ul>`
    : `<div class="empty-state">No hay puntuaciones pendientes.</div>`;
  const canSubmit = !state.busy &&
    totals.pending > 0 &&
    state.data?.session?.hasSession &&
    state.data?.membership?.canSubmit !== false &&
    state.data?.readiness?.canSubmit !== false;

  return `
    <section class="activity-drawer">
      <div class="activity-stats">
        <div><strong>${totals.pending}</strong><span>Pendientes</span></div>
        <div><strong>${totals.sent}</strong><span>Enviadas</span></div>
        <div class="${totals.failed ? "activity-stat--warning" : ""}"><strong>${totals.failed}</strong><span>Puntuaciones con error</span></div>
      </div>
      <div class="activity-actions">
        <button class="tool-button" type="button" data-action="submit" ${canSubmit ? "" : "disabled"}>
          Subir pendientes
          <small>${scoped ? "Cuenta + pack" : "Scope no disponible"}</small>
        </button>
      </div>
      <div class="activity-details__body">
        <div class="panel-heading compact">
          <div>
            <h3>Puntuaciones pendientes</h3>
            <p>Cola de seguridad · ${pending?.count || 0} guardadas · ${pending?.validCount || 0} válidas</p>
          </div>
        </div>
        ${body}
        ${renderFailedSection(failed)}
        <details class="technical-details">
          <summary>Detalles técnicos</summary>
          <dl>
            <div>
              <dt>Auto-sync</dt>
              <dd>${escapeHtml(autoSync.status || "sin estado")}</dd>
            </div>
            <div>
              <dt>Último intento</dt>
              <dd>${escapeHtml(autoSync.lastAttemptAt || "-")}</dd>
            </div>
            <div>
              <dt>Último éxito</dt>
              <dd>${escapeHtml(autoSync.lastSuccessAt || "-")}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>${escapeHtml(state.data?.scope?.scopedQueueRoot || "sin scope activo")}</dd>
            </div>
            <div>
              <dt>Enviadas leídas</dt>
              <dd>${escapeHtml(String(sent?.count || 0))}</dd>
            </div>
          </dl>
        </details>
      </div>
    </section>
  `;
}
