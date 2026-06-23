import { escapeHtml } from "./html.js";
import { renderLibraryEmptyState } from "./library-empty-state.js";
import { renderPackCard } from "./pack-card.js";

function renderLocations(state) {
  const locations = state.data?.library?.locations || [];

  if (locations.length === 0) {
    return renderLibraryEmptyState({
      action: {
        label: "+ Anadir ubicacion",
        type: "add-library-location",
      },
      body: "Anade una ubicacion para que High Score League detecte tus packs locales.",
      state,
      title: "Todavia no hay carpetas de packs.",
    });
  }

  return `
    <ul class="library-location-list">
      ${locations.map((location) => `
        <li class="library-location ${location.status === "missing" ? "library-location--missing" : ""}">
          <div class="min-w-0">
            <div class="library-location__title">
              <strong>${escapeHtml(location.path)}</strong>
              ${location.status === "missing" ? `<span class="badge badge-warn">No disponible</span>` : ""}
            </div>
            <p>${escapeHtml(location.packCount === 1 ? "1 pack detectado" : `${location.packCount || 0} packs detectados`)}</p>
            ${location.warnings?.length ? `<p class="library-location__warning">${escapeHtml(location.warnings[0])}</p>` : ""}
          </div>
          <button class="text-button" type="button" data-action="remove-library-location" data-location-id="${escapeHtml(location.id)}" ${state.busy ? "disabled" : ""}>
            Quitar
          </button>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPacks(state) {
  const packs = state.data?.library?.packs || [];
  const locations = state.data?.library?.locations || [];

  if (packs.length === 0) {
    if (locations.length === 0) {
      return "";
    }

    return renderLibraryEmptyState({
      body: "Cada pack debe tener un pack.json en una subcarpeta directa.",
      state,
      title: "No se han encontrado packs en estas ubicaciones.",
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

  return `
    <div class="library-summary" aria-label="Resumen de biblioteca">
      <span><strong>${totals.locations || 0}</strong> ubicaciones</span>
      <span><strong>${totals.packs || 0}</strong> packs</span>
      ${totals.packsWithErrors ? `<span><strong>${totals.packsWithErrors}</strong> requieren atencion</span>` : ""}
      ${totals.missingLocations ? `<span><strong>${totals.missingLocations}</strong> no disponibles</span>` : ""}
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
          <p>Packs detectados en tus carpetas locales.</p>
        </div>
        <button class="text-button" type="button" data-action="refresh" ${disabled}>Refrescar</button>
      </div>
      ${renderLibrarySummary(data)}
      <div class="library-toolbar">
        <button class="tool-button account-primary" type="button" data-action="add-library-location" ${disabled}>
          + Anadir ubicacion
        </button>
      </div>
      <div class="library-section library-section--locations">
        <h3>Ubicaciones</h3>
        ${renderLocations(state)}
      </div>
      <div class="library-section library-section--packs">
        <h3>Packs detectados</h3>
        ${renderPacks(state)}
      </div>
    </section>
  `;
}
