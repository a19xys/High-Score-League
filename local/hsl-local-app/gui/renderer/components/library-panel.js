import { escapeHtml } from "./html.js";

function statusLabel(status) {
  if (status === "error") return "Requiere atencion";
  if (status === "warning") return "Con avisos";
  if (status === "missing") return "No disponible";
  return "Listo";
}

function statusClass(status) {
  if (status === "error") return "badge badge-error";
  if (status === "warning" || status === "missing") return "badge badge-warn";
  return "badge badge-ok";
}

function renderLocations(state) {
  const locations = state.data?.library?.locations || [];

  if (locations.length === 0) {
    return `<p class="library-empty">Anade una carpeta donde guardes packs descomprimidos.</p>`;
  }

  return `
    <ul class="library-location-list">
      ${locations.map((location) => `
        <li class="library-location">
          <div class="min-w-0">
            <strong>${escapeHtml(location.path)}</strong>
            ${location.warnings?.length ? `<p>${escapeHtml(location.warnings[0])}</p>` : ""}
          </div>
          <button class="text-button" type="button" data-action="remove-library-location" data-location-id="${escapeHtml(location.id)}" ${state.busy ? "disabled" : ""}>
            Quitar
          </button>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPackThumb(pack) {
  const asset = pack.cover || pack.icon || pack.logo;

  if (!asset?.url) {
    return `<div class="library-pack-thumb" aria-hidden="true">${escapeHtml((pack.title || "P").slice(0, 1).toUpperCase())}</div>`;
  }

  return `<img class="library-pack-thumb" src="${escapeHtml(asset.url)}" alt="">`;
}

function renderPacks(state) {
  const packs = state.data?.library?.packs || [];

  if (packs.length === 0) {
    return `<p class="library-empty">No hay packs detectados en las ubicaciones guardadas.</p>`;
  }

  return `
    <ul class="library-pack-list">
      ${packs.map((pack) => `
        <li class="library-pack">
          ${renderPackThumb(pack)}
          <div class="min-w-0">
            <strong>${escapeHtml(pack.title)}</strong>
            <p>${escapeHtml(pack.subtitle || pack.weekId || pack.rom || "Pack local")}</p>
            <span class="${statusClass(pack.status)}">${statusLabel(pack.status)}</span>
          </div>
          <button class="tool-button library-use-button" type="button" data-action="use-library-pack" data-pack-id="${escapeHtml(pack.id)}" ${state.busy || pack.status === "error" ? "disabled" : ""}>
            Usar este pack
          </button>
        </li>
      `).join("")}
    </ul>
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
          <h2>Biblioteca de packs</h2>
          <p>Ubicaciones locales con packs descomprimidos.</p>
        </div>
      </div>
      <button class="tool-button account-primary" type="button" data-action="add-library-location" ${disabled}>
        + Añadir ubicación
      </button>
      <div class="library-section">
        <h3>Ubicaciones</h3>
        ${renderLocations(state)}
      </div>
      <div class="library-section">
        <h3>Packs detectados</h3>
        ${renderPacks(state)}
      </div>
    </section>
  `;
}
