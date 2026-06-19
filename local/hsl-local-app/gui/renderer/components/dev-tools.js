import { escapeHtml } from "./html.js";

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
  const membershipLabel = membership
    ? `${membership.status}${membership.technicalReason ? `: ${membership.technicalReason}` : ""}`
    : "sin comprobacion";
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
          <div>
            <dt>Participacion</dt>
            <dd>${escapeHtml(membershipLabel)}</dd>
          </div>
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
