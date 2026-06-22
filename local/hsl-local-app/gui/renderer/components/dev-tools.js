import { escapeHtml } from "./html.js";

function valueOrDash(value) {
  if (value === undefined || value === null || value === "") {
    return "-";
  }

  return String(value);
}

function detailRow(label, value) {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(valueOrDash(value))}</dd>
    </div>
  `;
}

function renderReadinessChecks(readiness) {
  if (!readiness?.checks?.length) {
    return "";
  }

  return `
    <div>
      <dt>Preparacion del pack</dt>
      <dd>
        <ul class="readiness-check-list">
          ${readiness.checks.map((check) => `
            <li>
              <span class="check-level check-level--${escapeHtml(check.level)}">${escapeHtml(check.level)}</span>
              <strong>${escapeHtml(check.label)}</strong>
              <span>${escapeHtml(check.message)}</span>
              ${check.technicalDetails?.length
                ? `<small>${escapeHtml(check.technicalDetails.join(" | "))}</small>`
                : ""}
            </li>
          `).join("")}
        </ul>
      </dd>
    </div>
  `;
}

export function renderDevTools(state) {
  const data = state.data;
  const disabled = state.busy ? "disabled" : "";
  const syncDisabled = state.busy || !data?.bridge?.devBridge ? "disabled" : "";
  const metadataWarnings = data?.bridge?.packMetadataWarnings || data?.game?.metadataWarnings || [];
  const metadataLabel = metadataWarnings.length > 0
    ? metadataWarnings.join(" | ")
    : data?.bridge?.packMetadataLoaded
      ? "metadata.json cargado"
      : "sin metadata local";
  const membership = data?.membership;
  const autoSync = data?.autoSync;
  const readiness = data?.readiness;
  const modeLabel = data?.bridge?.packOpened
    ? "pack abierto"
    : data?.bridge?.devBridge
      ? "modo desarrollo puente"
      : data?.bridge?.mode || "desconocido";

  return `
    <section class="panel dev-tools">
      <div class="panel-heading compact">
        <div>
          <h2>Herramientas de desarrollo</h2>
          <p>Diagnóstico y datos técnicos quedan separados del flujo de juego.</p>
        </div>
      </div>
      <div class="dev-actions">
        <button class="tool-button" type="button" data-action="diagnose" ${disabled}>
          Diagnosticar
        </button>
        <button class="tool-button" type="button" data-action="sync-plugin" ${syncDisabled}>
          Sincronizar plugin
          <small>Solo desarrollo</small>
        </button>
        <button class="tool-button" type="button" data-action="logout" ${disabled}>
          Cerrar sesión local
        </button>
      </div>
      <details class="technical-details">
        <summary>Detalles técnicos</summary>
        <dl>
          <div>
            <dt>Modo</dt>
            <dd>${escapeHtml(modeLabel)}</dd>
          </div>
          <div>
            <dt>Pack / MAME</dt>
            <dd>${escapeHtml(data?.bridge?.workingDir || data?.bridge?.packRoot || data?.bridge?.packPath || "sin ruta activa")}</dd>
          </div>
          <div>
            <dt>Metadata</dt>
            <dd>${escapeHtml(metadataLabel)}</dd>
          </div>
          ${detailRow("Comprobacion de temporada", membership?.status || "sin comprobacion")}
          ${detailRow("URL consultada", membership?.request?.url)}
          ${detailRow("HTTP status", membership?.response?.httpStatus)}
          ${detailRow("Body status", membership?.response?.bodyStatus)}
          ${detailRow("Body ok", membership?.response?.bodyOk)}
          ${detailRow("Mensaje", membership?.response?.bodyMessage || membership?.message)}
          ${detailRow("Motivo tecnico", membership?.technicalReason)}
          ${detailRow("Comprobado", membership?.checkedAt)}
          ${detailRow("WeekId", membership?.weekId)}
          ${detailRow("SeasonId", membership?.seasonId)}
          ${detailRow("Auto-sync estado", autoSync?.status)}
          ${detailRow("Auto-sync motivo", autoSync?.reason)}
          ${detailRow("Auto-sync ultimo intento", autoSync?.lastAttemptAt)}
          ${detailRow("Auto-sync ultimo exito", autoSync?.lastSuccessAt)}
          ${detailRow("Auto-sync pending antes", autoSync?.pendingBefore)}
          ${detailRow("Auto-sync pending despues", autoSync?.pendingAfter)}
          ${renderReadinessChecks(readiness)}
          <div>
            <dt>Cola</dt>
            <dd>${escapeHtml(data?.queue?.pending?.dir || "sin ruta activa")}</dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>${escapeHtml(data?.scope?.scopedQueueRoot || "sin scope activo")}</dd>
          </div>
          <div>
            <dt>Staging plugin</dt>
            <dd>${escapeHtml(data?.scope?.stagingPendingDir || "sin staging activo")}</dd>
          </div>
          <div>
            <dt>Sesión</dt>
            <dd>${escapeHtml(data?.session?.sessionFile || "sin archivo local")}</dd>
          </div>
        </dl>
      </details>
    </section>
  `;
}
