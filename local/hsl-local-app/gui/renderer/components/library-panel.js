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

function favoriteFilterActive(state) {
  return state.libraryFavoriteFilter === "favorites" && Boolean(state.data?.session?.hasSession);
}

function normalizeSortBy(value) {
  return ["weeks", "title", "developer", "year"].includes(value) ? value : "weeks";
}

function normalizeSortDirection(value) {
  return value === "desc" ? "desc" : "asc";
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

function weekSortValue(pack) {
  return [
    pack.seasonName || pack.seasonId || "",
    Number.isFinite(Number(pack.weekNumber)) ? Number(pack.weekNumber) : Number.MAX_SAFE_INTEGER,
    pack.weekId || "",
    pack.title || "",
  ];
}

function compareWeeks(a, b) {
  const left = weekSortValue(a);
  const right = weekSortValue(b);
  const season = compareText(left[0], right[0]);
  if (season) return season;
  if (left[1] !== right[1]) return left[1] - right[1];
  const week = compareText(left[2], right[2]);
  if (week) return week;
  return compareText(left[3], right[3]);
}

function comparePacks(a, b, sortBy) {
  if (sortBy === "developer") {
    const developer = compareText(a.developer || a.publisher || a.title, b.developer || b.publisher || b.title);
    return developer || compareText(a.title, b.title);
  }

  if (sortBy === "year") {
    const leftYear = Number(a.year);
    const rightYear = Number(b.year);
    const left = Number.isFinite(leftYear) ? leftYear : Number.MAX_SAFE_INTEGER;
    const right = Number.isFinite(rightYear) ? rightYear : Number.MAX_SAFE_INTEGER;
    return left === right ? compareText(a.title, b.title) : left - right;
  }

  if (sortBy === "weeks") {
    return compareWeeks(a, b);
  }

  return compareText(a.title, b.title);
}

function sortPacks(packs, state) {
  const sortBy = normalizeSortBy(state.librarySortBy);
  const direction = normalizeSortDirection(state.librarySortDirection);
  const factor = direction === "desc" ? -1 : 1;

  if (sortBy === "year") {
    return [...packs].sort((a, b) => {
      const leftYear = Number(a.year);
      const rightYear = Number(b.year);
      const leftHasYear = Number.isFinite(leftYear);
      const rightHasYear = Number.isFinite(rightYear);

      if (leftHasYear && rightHasYear && leftYear !== rightYear) {
        return (leftYear - rightYear) * factor;
      }

      if (leftHasYear !== rightHasYear) {
        return leftHasYear ? -1 : 1;
      }

      return compareText(a.title, b.title) * factor;
    });
  }

  return [...packs].sort((a, b) => comparePacks(a, b, sortBy) * factor);
}

function filterPacks(packs, state) {
  const query = normalizeSearch(state.libraryQuery);
  const favoritesOnly = favoriteFilterActive(state);

  return packs.filter((pack) => {
    const matchesQuery = !query || searchText(pack).includes(query);
    const matchesSeason = state.librarySeason === "all" ||
      (state.librarySeason === "legacy" && pack.deprecated) ||
      (state.librarySeason === "unseasoned" && !pack.seasonId && !pack.deprecated) ||
      pack.seasonId === state.librarySeason;
    const matchesFavorite = !favoritesOnly || Boolean(pack.favorite);

    return matchesQuery && matchesSeason && matchesFavorite && matchesStatus(pack, state.libraryStatus);
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
    <button class="view-button ${active ? "view-button--active" : ""}" type="button" data-action="set-library-view" data-view="${view}" aria-label="${label}" title="${label}" aria-pressed="${active}">
      <span class="library-view-button__icon">${renderIcon(iconName, { className: `library-view-icon icon-slot icon-slot--${icon}` })}</span>
      <span class="library-view-button__label">${label}</span>
    </button>
  `;
}

function sortOption(value, current, label) {
  return `<option value="${value}" ${current === value ? "selected" : ""}>${label}</option>`;
}

function renderSortDirectionButton(sortDirection) {
  const descending = sortDirection === "desc";
  const nextDirection = descending ? "asc" : "desc";
  const label = descending ? "Orden descendente" : "Orden ascendente";
  const icon = descending ? "arrow-down" : "arrow-up";

  return `
    <button class="library-sort-direction-button" type="button" data-action="toggle-library-sort-direction" data-direction="${nextDirection}" aria-label="${label}" title="${label}">
      ${renderIcon(icon, { className: "library-sort-direction-icon", fallback: descending ? "↓" : "↑" })}
    </button>
  `;
}

function renderFavoriteFilterButton(state) {
  const hasSession = Boolean(state.data?.session?.hasSession);
  const active = favoriteFilterActive(state);
  const nextFilter = active ? "all" : "favorites";
  const label = !hasSession
    ? "Inicia sesión para filtrar favoritos"
    : active ? "Mostrar todos" : "Mostrar favoritos";
  const icon = active ? "star-filled" : "star-empty";

  return `
    <button class="library-favorite-filter-button ${active ? "library-favorite-filter-button--active" : ""}" type="button" data-action="toggle-library-favorite-filter" data-filter="${nextFilter}" aria-label="${label}" title="${label}" aria-pressed="${active ? "true" : "false"}" ${hasSession ? "" : "disabled"}>
      ${renderIcon(icon, { className: "library-favorite-filter-icon" })}
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

  const sortBy = normalizeSortBy(state.librarySortBy);
  const sortDirection = normalizeSortDirection(state.librarySortDirection);

  return `
    <div class="library-filter-card" id="library-filter-card">
      <div class="library-search">
        <span id="library-search-label">Búsqueda general</span>
        <input type="search" placeholder="Escribe aquí..." data-library-search value="${escapeHtml(state.libraryQuery)}" aria-labelledby="library-search-label">
      </div>
      <div class="library-filters">
        <div class="library-filter-field">
          <span id="library-season-label">Temporada</span>
          <select data-library-season aria-labelledby="library-season-label">
            <option value="all" ${state.librarySeason === "all" ? "selected" : ""}>Todas</option>
            ${[...seasons.entries()].map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.librarySeason === id ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
            <option value="unseasoned" ${state.librarySeason === "unseasoned" ? "selected" : ""}>Sin temporada</option>
            <option value="legacy" ${state.librarySeason === "legacy" ? "selected" : ""}>Legacy</option>
          </select>
        </div>
      </div>
      <div class="library-sort">
        <span class="library-filter-heading">ORDENAR</span>
        <div class="library-sort__controls">
          <select data-library-sort-by aria-label="Criterio de orden">
            ${sortOption("weeks", sortBy, "Semanas")}
            ${sortOption("title", sortBy, "Alfabético")}
            ${sortOption("developer", sortBy, "Desarrollador")}
            ${sortOption("year", sortBy, "Año")}
          </select>
          ${renderSortDirectionButton(sortDirection)}
          ${renderFavoriteFilterButton(state)}
        </div>
      </div>
    </div>
  `;
}

function renderLibraryControls(state, packs) {
  const filtersOpen = Boolean(state.libraryFiltersOpen);
  const disabled = state.busy ? "disabled" : "";
  const hasDirectory = Boolean(state.data?.library?.directory?.path);
  const locationLabel = hasDirectory ? "Cambiar ubicación" : "Añadir ubicación";

  return `
    <div class="library-toolbar">
      <div class="library-control-row library-control-row--primary">
        <button class="library-control-button" type="button" data-action="choose-pack-directory" ${disabled} aria-label="${locationLabel}" title="${locationLabel}">
          ${renderIcon("folder", { className: "library-control-icon" })}
          <span>${locationLabel}</span>
        </button>
        <button class="library-control-button library-filter-toggle ${filtersOpen ? "library-filter-toggle--open" : ""}" type="button" data-action="toggle-library-filters" aria-label="Filtros" title="Filtros" aria-expanded="${filtersOpen ? "true" : "false"}" aria-controls="library-filter-card">
          ${renderIcon("filter", { className: "library-control-icon" })}
          <span>Filtros</span>
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
  const sorted = sortPacks(filtered, state);
  const sortBy = normalizeSortBy(state.librarySortBy);

  if (filtered.length === 0) {
    if (favoriteFilterActive(state)) {
      return renderLibraryEmptyState({
        body: "Marca algún pack como favorito.",
        state,
        title: "No hay favoritos todavía.",
      });
    }

    return renderLibraryEmptyState({
      body: "Prueba otra búsqueda o temporada.",
      state,
      title: "No hay packs que coincidan con los filtros.",
    });
  }

  if (sortBy !== "weeks") {
    return `
      <div class="library-pack-grid library-pack-grid--${escapeHtml(state.libraryView)}">
        ${sorted.map((pack) => renderPackCard(pack, state, state.libraryView)).join("")}
      </div>
    `;
  }

  return groupPacks(sorted).map((group) => `
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

  const hasDirectory = Boolean(data.library?.directory?.path);
  const disabled = state.busy ? "disabled" : "";
  const openDirectoryDisabled = !hasDirectory ? "disabled" : disabled;
  const rescanning = state.busy && state.busyLabel === "Reescaneando";

  return `
    <section class="panel library-panel">
      <div class="panel-heading compact">
        <div class="library-title-row">
          <button class="library-heading-button" type="button" data-action="open-pack-directory" ${openDirectoryDisabled} aria-label="Abrir carpeta de packs" title="Abrir carpeta de packs">
            ${renderIcon("library", { className: "library-heading-icon" })}
          </button>
          <h2>Biblioteca</h2>
          <button class="library-heading-button ${rescanning ? "library-heading-button--spinning" : ""}" type="button" data-action="rescan-pack-directory" ${disabled} aria-label="Reescanear biblioteca" title="Reescanear biblioteca" aria-busy="${rescanning ? "true" : "false"}">
            ${renderIcon("refresh", { className: "library-heading-icon" })}
          </button>
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
  comparePacks,
  favoriteFilterActive,
  filterPacks,
  groupPacks,
  normalizeSearch,
  normalizeSortBy,
  normalizeSortDirection,
  searchText,
  sortPacks,
};
