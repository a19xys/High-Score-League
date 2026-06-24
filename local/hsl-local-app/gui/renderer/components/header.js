import { COPY } from "./copy.js";
import { escapeHtml } from "./html.js";

export function renderHeader(state) {
  const themeLabel = state.theme === "dark" ? "Claro" : "Oscuro";
  const busyText = state.busy ? `<span class="busy-chip">${escapeHtml(state.busyLabel || "Ejecutando")}</span>` : "";
  const session = state.data?.session;
  const sessionText = session?.hasSession
    ? session.email || "Cuenta conectada"
    : "Sin cuenta conectada";
  const connection = {
    connected: ["Conectado", "connection-chip--connected"],
    offline: ["Sin Internet", "connection-chip--offline"],
    reconnecting: ["Reconectando", "connection-chip--reconnecting"],
  }[state.connectionStatus] || ["Conectado", "connection-chip--connected"];

  return `
    <header class="launcher-header">
      <div>
        <p class="eyebrow">HSL</p>
        <h1>High Score League Launcher</h1>
        <p class="header-subtitle">${COPY.launcherSubtitle}</p>
      </div>
      <div class="header-actions">
        ${busyText}
        <span class="connection-chip ${connection[1]}"><i aria-hidden="true"></i>${connection[0]}</span>
        <span class="session-chip">${escapeHtml(sessionText)}</span>
        <button class="icon-button" type="button" data-action="refresh" title="Actualizar estado">&#8635;</button>
        <button class="theme-button" type="button" data-action="toggle-theme">${themeLabel}</button>
      </div>
    </header>
  `;
}
