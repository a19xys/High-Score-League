import { escapeHtml } from "./html.js";
import { renderLibraryEmptyState } from "./library-empty-state.js";
import { renderPackCard } from "./pack-card.js";

function compactPath(value) {
  if (!value) {
    return "";
  }

  const normalized = String(value).replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length <= 3) {
    return normalized;
  }

  return `.../${parts.slice(-2).join("/")}`;
}

function renderDirectoryPanel(state) {
  const directory = state.data?.library?.directory || {};
  const disabled = state.busy ? "disabled" : "";

  if (!directory.path) {
    return renderLibraryEmptyState({
      action: {
        label: "Elegir directorio",
        type: "choose-pack-directory",
      },
      body: "Elige una carpeta donde High Score League guardara y buscara tus packs locales.",
      state,
      title: "Todavia no has elegido un directorio de packs.",
    });
  }

  const warning = directory.status === "missing"
    ? "No encuentro el directorio de packs. Puedes cambiarlo o volver a crearlo."
    : directory.status === "pack-root"
      ? "Parece que has elegido una carpeta de pack. Elige la carpeta que contiene todos tus packs."
      : directory.warnings?.[0] || null;

  return `
    <div class="pack-directory ${directory.status === "missing" || directory.status === "pack-root" ? "pack-directory--warning" : ""}">
      <div class="min-w-0">
        <h3>Directorio de packs</h3>
        <p class="pack-directory__path" title="${escapeHtml(directory.path)}">${escapeHtml(compactPath(directory.path))}</p>
        ${warning ? `<p class="pack-directory__warning">${escapeHtml(warning)}</p>` : ""}
      </div>
      <div class="pack-directory__actions">
        <button class="text-button" type="button" data-action="choose-pack-directory" ${disabled}>
          Cambiar directorio
        </button>
        <button class="text-button" type="button" data-action="open-pack-directory" ${disabled || !directory.exists ? "disabled" : ""}>
          Abrir directorio
        </button>
        <button class="text-button" type="button" data-action="rescan-pack-directory" ${disabled}>
          Reescanear
        </button>
      </div>
    </div>
  `;
}

function renderPacks(state) {
  const packs = state.data?.library?.packs || [];
  const directory = state.data?.library?.directory || {};

  if (!directory.path) {
    return "";
  }

  if (directory.status === "pack-root") {
    return renderLibraryEmptyState({
      body: "Has seleccionado la carpeta de un juego. Cambia al directorio que contiene todos tus packs.",
      state,
      title: "Ese directorio parece un pack.",
    });
  }

  if (packs.length === 0) {
    return renderLibraryEmptyState({
      body: "Cada pack debe estar en una subcarpeta directa con pack.json.",
      state,
      title: directory.status === "missing"
        ? "No puedo escanear el directorio de packs."
        : "No se han encontrado packs en este directorio.",
    });
  }

  return `
    <div class="library-pack-grid">
      ${packs.map((pack) => renderPackCard(pack, state)).join("")}
    </div>
  `;
}

function renderLibrarySummary(data) {
  const totals = data?.library?.totals || {};
  const directory = data?.library?.directory || {};

  return `
    <div class="library-summary" aria-label="Resumen de biblioteca">
      <span><strong>${directory.path ? "1" : "0"}</strong> directorio</span>
      <span><strong>${totals.packs || 0}</strong> packs</span>
      ${totals.packsWithErrors ? `<span><strong>${totals.packsWithErrors}</strong> requieren atencion</span>` : ""}
      ${totals.directoryMissing ? `<span><strong>${totals.directoryMissing}</strong> no disponible</span>` : ""}
    </div>
  `;
}

export function renderLibraryPanel(state) {
  const data = state.data;
  const disabled = state.busy ? "disabled" : "";

  if (!data) {
    return `<section class="panel library-panel skeleton-panel"></section>`;
  }

  return `
    <section class="panel library-panel">
      <div class="panel-heading compact">
        <div>
          <h2>Biblioteca local</h2>
          <p>Packs detectados en tu directorio local.</p>
        </div>
        <button class="text-button" type="button" data-action="rescan-pack-directory" ${disabled}>Reescanear</button>
      </div>
      ${renderLibrarySummary(data)}
      <div class="library-section library-section--directory">
        ${renderDirectoryPanel(state)}
      </div>
      <div class="library-section library-section--packs">
        <h3>Packs detectados</h3>
        ${renderPacks(state)}
      </div>
    </section>
  `;
}

export const libraryPanelTestApi = {
  compactPath,
};
