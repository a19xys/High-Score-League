import { escapeHtml } from "./html.js";

export function busyMessageFromLabel(label) {
  const normalized = String(label || "").trim();

  if (!normalized) {
    return "Cargando. Espera...";
  }

  const messages = {
    "Abriendo directorio": "Abriendo la carpeta. Espera...",
    "Abriendo MAME": "Abriendo la carpeta. Espera...",
    "Abriendo manual": "Abriendo el manual. Espera...",
    "Abriendo pack": "Abriendo el pack. Espera...",
    "Abriendo practica": "Abriendo el juego. Espera...",
    "Abriendo práctica": "Abriendo el juego. Espera...",
    "Abriendo ranking": "Abriendo el web. Espera...",
    "Abriendo web": "Abriendo el web. Espera...",
    "Activando pack": "Activando el pack. Espera...",
    Actualizando: "Actualizando estado. Espera...",
    "Cambiando cuenta": "Cambiando de cuenta. Espera...",
    "Cerrando sesion": "Cerrando sesión. Espera...",
    "Cerrando sesión": "Cerrando sesión. Espera...",
    "Comprobando temporada": "Comprobando temporada. Espera...",
    Conectando: "Conectando...",
    Diagnosticando: "Diagnosticando. Espera...",
    "Eligiendo directorio": "Escoge una ubicación para tus packs...",
    "Eligiendo MAME": "Escoge el ejecutable de MAME...",
    "Importando pack": "Importando pack. Espera...",
    "Quitando cuenta": "Olvidando cuenta. Espera...",
    Reescaneando: "Reescaneando biblioteca...",
    Restaurando: "Restaurando puntuación a pendientes...",
    "Subiendo puntuaciones": "Subiendo puntuaciones...",
    "Sincronizando plugin": "Sincronizando plugin. Espera...",
  };

  return messages[normalized] || `${normalized}. Espera...`;
}

export function renderBusyOverlay(state) {
  if (!state?.busy) {
    return "";
  }

  const message = busyMessageFromLabel(state.busyLabel);

  return `
    <div class="busy-overlay" role="status" aria-live="polite" aria-busy="true" aria-label="${escapeHtml(message)}">
      <div class="busy-overlay__panel">
        <div class="busy-overlay__media">
          <img class="busy-overlay__image" src="./assets/loading.gif" alt="Cargando" loading="eager" onerror="this.hidden = true; this.nextElementSibling.hidden = false">
          <span class="busy-overlay__spinner" aria-hidden="true" hidden></span>
        </div>
        <p class="busy-overlay__message">${escapeHtml(message)}</p>
        <p class="busy-overlay__hint">El launcher está terminando esta acción.</p>
      </div>
    </div>
  `;
}
