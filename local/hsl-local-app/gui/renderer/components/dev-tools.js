import { escapeHtml } from "./html.js";

export function renderDevTools(state) {
  const data = state.data;
  const disabled = state.busy ? "disabled" : "";
  const syncDisabled = state.busy || !data?.bridge?.devBridge ? "disabled" : "";

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
            <dd>${escapeHtml(data?.bridge?.devBridge ? "dev bridge" : data?.bridge?.mode || "desconocido")}</dd>
          </div>
          <div>
            <dt>Pack / MAME</dt>
            <dd>${escapeHtml(data?.bridge?.workingDir || data?.bridge?.packPath || "sin ruta activa")}</dd>
          </div>
          <div>
            <dt>Cola</dt>
            <dd>${escapeHtml(data?.queue?.pending?.dir || "sin ruta activa")}</dd>
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
