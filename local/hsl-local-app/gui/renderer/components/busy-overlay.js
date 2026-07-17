import { escapeHtml } from "./html.js";

const DEFAULT_BUSY_CONTENT = Object.freeze({
  title: "Cargando...",
  hint: "Espera un momento...",
  variant: "working",
});

const BUSY_CONTENT_BY_LABEL = Object.freeze({
  "Comprobando conexi\u00f3n": {
    title: "Comprobando conexi\u00f3n...",
    hint: "Verificando el acceso a High Score League.",
    variant: "working",
  },
  "Abriendo competición": {
    title: "Abriendo competición...",
    hint: "Preparando todo para jugar.",
    variant: "mame",
  },

  "Competición en curso": {
    title: "Competición en curso...",
    hint: "MAME está abierto. Cierra el emulador al terminar.",
    variant: "mame",
  },

  "Cerrando competición": {
    title: "Cerrando competición...",
    hint: "Regresando al launcher.",
    variant: "mame",
  },

  "Abriendo práctica": {
    title: "Abriendo práctica...",
    hint: "Preparando todo para practicar.",
    variant: "mame",
  },

  "Abriendo practica": {
    title: "Abriendo práctica...",
    hint: "Preparando todo para practicar.",
    variant: "mame",
  },

  "Práctica en curso": {
    title: "Práctica en curso...",
    hint: "MAME está abierto. Cierra el emulador al terminar.",
    variant: "mame",
  },

  "Cerrando práctica": {
    title: "Cerrando práctica...",
    hint: "Regresando al launcher.",
    variant: "mame",
  },

  "Abriendo directorio": {
    title: "Abriendo carpeta de packs...",
    hint: "Mostrando la carpeta con tus juegos.",
    variant: "working",
  },

  "Abriendo MAME": {
    title: "Abriendo carpeta de MAME...",
    hint: "Mostrando la ubicación del emulador.",
    variant: "working",
  },

  "Abriendo manual": {
    title: "Abriendo manual...",
    hint: "Mostrando la documentación del juego.",
    variant: "working",
  },

  "Abriendo pack": {
    title: "Abriendo pack...",
    hint: "Cargando los datos del juego.",
    variant: "working",
  },

  "Abriendo ranking": {
    title: "Abriendo ranking...",
    hint: "Mostrando la clasificación del juego.",
    variant: "working",
  },

  "Abriendo web": {
    title: "Abriendo web...",
    hint: "Abriendo High Score League en el navegador.",
    variant: "working",
  },

  "Activando pack": {
    title: "Activando pack...",
    hint: "Cargando los datos del juego.",
    variant: "working",
  },

  "Actualizando": {
    title: "Actualizando...",
    hint: "Espera un momento...",
    variant: "working",
  },

  "Cambiando cuenta": {
    title: "Cambiando cuenta...",
    hint: "Preparando la sesión de tu cuenta.",
    variant: "working",
  },

  "Cerrando sesión": {
    title: "Cerrando sesión...",
    hint: "Espera un momento...",
    variant: "working",
  },

  "Cerrando sesion": {
    title: "Cerrando sesión...",
    hint: "Espera un momento...",
    variant: "working",
  },

  "Comprobando temporada": {
    title: "Comprobando temporada...",
    hint: "Revisando si puedes participar en esta competición.",
    variant: "working",
  },

  "Conectando": {
    title: "Conectando...",
    hint: "Iniciando sesión en High Score League.",
    variant: "working",
  },

  "Creando diagn\u00f3stico": {
    title: "Creando diagn\u00f3stico...",
    hint: "Recopilando el estado del launcher.",
    variant: "working",
  },

  "Eligiendo ZIP": {
    title: "Escoge un archivo ZIP...",
    hint: "Selecciona el pack que quieres importar.",
    variant: "waiting-user",
  },

  "Eligiendo carpeta": {
    title: "Escoge una carpeta...",
    hint: "Selecciona la carpeta que quieres importar.",
    variant: "waiting-user",
  },

  "Eligiendo directorio": {
    title: "Escoge una carpeta...",
    hint: "Selecciona dónde se instalarán tus juegos.",
    variant: "waiting-user",
  },

  "Eligiendo MAME": {
    title: "Escoge MAME...",
    hint: "Selecciona el ejecutable del emulador.",
    variant: "waiting-user",
  },

  "Importando pack": {
    title: "Importando pack...",
    hint: "Instalando el juego en tu biblioteca.",
    variant: "working",
  },

  "Iniciando": {
    title: "Iniciando...",
    hint: "Espera un momento...",
    variant: "startup",
  },

  "Quitando cuenta": {
    title: "Olvidando cuenta...",
    hint: "Quitando esta cuenta del launcher.",
    variant: "working",
  },

  "Reescaneando": {
    title: "Reescaneando biblioteca...",
    hint: "Buscando packs instalados.",
    variant: "working",
  },

  "Restaurando": {
    title: "Restaurando puntuación...",
    hint: "Moviendo la puntuación de vuelta a pendientes.",
    variant: "working",
  },

  "Subiendo puntuaciones": {
    title: "Subiendo puntuaciones...",
    hint: "Enviando tus partidas a la liga.",
    variant: "working",
  },

  "Sincronizando plugin": {
    title: "Sincronizando plugin...",
    hint: "Actualizando archivos del pack.",
    variant: "working",
  },
});

export function busyContentFromLabel(label) {
  const normalized = String(label || "").trim();

  if (!normalized) {
    return DEFAULT_BUSY_CONTENT;
  }

  return BUSY_CONTENT_BY_LABEL[normalized] || {
    title: `${normalized}...`,
    hint: "Espera un momento...",
    variant: "working",
  };
}

export function busyMessageFromLabel(label) {
  return busyContentFromLabel(label).title;
}

export function renderBusyOverlay(state) {
  if (!state?.busy) {
    return "";
  }

  const content = busyContentFromLabel(state.busyLabel);
  const label = `${content.title} ${content.hint}`;

  return `
    <div class="busy-overlay busy-overlay--${escapeHtml(content.variant)}" role="status" aria-live="polite" aria-busy="true" aria-label="${escapeHtml(label)}">
      <div class="busy-overlay__panel">
        <div class="busy-overlay__media">
          <img class="busy-overlay__image" data-hsl-loading-image src="./assets/loading.gif" alt="Cargando" loading="eager">
          <span class="busy-overlay__spinner" aria-hidden="true" hidden></span>
        </div>
        <p class="busy-overlay__message">${escapeHtml(content.title)}</p>
        <p class="busy-overlay__hint">${escapeHtml(content.hint)}</p>
      </div>
    </div>
  `;
}
