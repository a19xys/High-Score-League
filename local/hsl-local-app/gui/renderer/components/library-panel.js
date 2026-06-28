import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";
import { renderLibraryEmptyState } from "./library-empty-state.js";
import { renderPackCard } from "./pack-card.js";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function searchText(pack) {
  return normalizeSearch([
    pack.title,
    pack.subtitle,
    pack.developer,
    pack.publisher,
    pack.year,
    ...(pack.genre || []),
    pack.rom,
    pack.gameId,
    pack.packId,
    pack.seasonName,
    pack.weekId,
  ].filter(Boolean).join(" "));
}

function matchesStatus(pack, filter) {
  if (filter === "all") return true;
  if (filter === "legacy") return pack.deprecated === true;
  if (filter === "attention") return pack.status === "error";
  if (filter === "installed") return pack.status !== "missing";
  return pack.status === filter;
}

function filterPacks(packs, state) {
  const query = normalizeSearch(state.libraryQuery);

  return packs.filter((pack) => {
    const matchesQuery = !query || searchText(pack).includes(query);
    const matchesSeason = state.librarySeason === "all" ||
      (state.librarySeason === "legacy" && pack.deprecated) ||
      (state.librarySeason === "unseasoned" && !pack.seasonId && !pack.deprecated) ||
      pack.seasonId === state.librarySeason;

    return matchesQuery && matchesSeason && matchesStatus(pack, state.libraryStatus);
  });
}

function groupPacks(packs) {
  const groups = new Map();

  for (const pack of packs) {
    const id = pack.seasonId
        ? `season:${pack.seasonId}`
        : "unseasoned";
    const title = pack.seasonName || pack.seasonId || "Sin temporada";

    if (!groups.has(id)) {
      groups.set(id, {
        id,
        packs: [],
        title,
      });
    }

    groups.get(id).packs.push(pack);
  }

  return [...groups.values()];
}

function renderViewButton(state, view, label, icon) {
  const active = state.libraryView === view;
  const iconName = `view-${icon}`;

  return `
    <button class="view-button ${active ? "view-button--active" : ""}" type="button" data-action="set-library-view" data-view="${view}" aria-pressed="${active}">
      ${renderIcon(iconName, { className: `library-view-icon icon-slot icon-slot--${icon}` })}
      <span>${label}</span>
    </button>
  `;
}

function renderFilterCard(state, packs) {
  if (!state.libraryFiltersOpen) {
    return "";
  }

  const seasons = new Map();

  for (const pack of packs) {
    if (pack.seasonId) {
      seasons.set(pack.seasonId, pack.seasonName || pack.seasonId);
    }
  }

  return `
    <div class="library-filter-card" id="library-filter-card">
      <label class="library-search">
        <span>Búsqueda general</span>
        <input type="search" placeholder="Escribe aquí..." data-library-search value="${escapeHtml(state.libraryQuery)}">
      </label>
      <div class="library-filters">
        <label>
          <span>Temporada</span>
          <select data-library-season>
            <option value="all" ${state.librarySeason === "all" ? "selected" : ""}>Todas</option>
            ${[...seasons.entries()].map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.librarySeason === id ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
            <option value="unseasoned" ${state.librarySeason === "unseasoned" ? "selected" : ""}>Sin temporada</option>
            <option value="legacy" ${state.librarySeason === "legacy" ? "selected" : ""}>Legacy</option>
          </select>
        </label>
      </div>
    </div>
  `;
}

function renderLibraryControls(state, packs) {
  const filtersOpen = Boolean(state.libraryFiltersOpen);
  const disabled = state.busy ? "disabled" : "";

  return `
    <div class="library-toolbar">
      <div class="library-control-row library-control-row--primary">
        <button class="library-control-button" type="button" data-action="toggle-library-filters" aria-expanded="${filtersOpen ? "true" : "false"}" aria-controls="library-filter-card">
          Más filtros
        </button>
        <button class="library-control-button" type="button" data-action="choose-pack-directory" ${disabled}>
          Cambiar directorio
        </button>
      </div>
      ${renderFilterCard(state, packs)}
      <div class="library-views" aria-label="Vista de biblioteca">
        ${renderViewButton(state, "covers", "Portadas", "covers")}
        ${renderViewButton(state, "list", "Lista", "list")}
        ${renderViewButton(state, "icons", "Iconos", "icons")}
      </div>
    </div>
  `;
}

function renderPacks(state) {
  const packs = state.data?.library?.packs || [];
  const directory = state.data?.library?.directory || {};

  if (!directory.path) {
    return renderLibraryEmptyState({
      action: {
        label: "Elegir directorio",
        type: "choose-pack-directory",
      },
      body: "Elige una carpeta donde High Score League guardará y buscará tus packs locales.",
      state,
      title: "Todavía no has elegido un directorio de packs.",
    });
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

  const filtered = filterPacks(packs, state);

  if (filtered.length === 0) {
    return renderLibraryEmptyState({
      body: "Prueba otra búsqueda o temporada.",
      state,
      title: "No hay packs que coincidan con los filtros.",
    });
  }

  return groupPacks(filtered).map((group) => `
    <section class="season-group">
      <div class="season-group__heading">
        <h3>${escapeHtml(group.title)}</h3>
        <span>${group.packs.length} ${group.packs.length === 1 ? "pack" : "packs"}</span>
      </div>
      <div class="library-pack-grid library-pack-grid--${escapeHtml(state.libraryView)}">
        ${group.packs.map((pack) => renderPackCard(pack, state, state.libraryView)).join("")}
      </div>
    </section>
  `).join("");
}

function renderLibraryCount(data) {
  const count = data?.library?.totals?.packs || 0;

  return `${count} ${count === 1 ? "pack" : "packs"}`;
}

export function renderLibraryPanel(state) {
  const data = state.data;

  if (!data) {
    return `<section class="panel library-panel skeleton-panel"></section>`;
  }

  return `
    <section class="panel library-panel">
      <div class="panel-heading compact">
        <div class="library-title-row">
          <h2>Biblioteca</h2>
          <span class="library-count-pill">${escapeHtml(renderLibraryCount(data))}</span>
        </div>
      </div>
      ${renderLibraryControls(state, data.library?.packs || [])}
      <div class="library-section library-section--packs">
        ${renderPacks(state)}
      </div>
    </section>
  `;
}

export const libraryPanelTestApi = {
  filterPacks,
  groupPacks,
  normalizeSearch,
  searchText,
};
