export function renderHeader(state) {
  const themeLabel = state.theme === "dark" ? "Claro" : "Oscuro";
  const busyText = state.busy ? `<span class="busy-chip">${state.busyLabel || "Ejecutando"}</span>` : "";

  return `
    <header class="launcher-header">
      <div>
        <p class="eyebrow">High Score League</p>
        <h1>Launcher local</h1>
      </div>
      <div class="header-actions">
        ${busyText}
        <button class="icon-button" type="button" data-action="refresh" title="Actualizar estado">↻</button>
        <button class="theme-button" type="button" data-action="toggle-theme">${themeLabel}</button>
      </div>
    </header>
  `;
}
