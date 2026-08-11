import { renderIcon } from "./components/icon.js";

function isActivePack(pack, state) {
  return Boolean(
    pack?.instanceKey &&
    state.data?.selection?.activeInstanceKey &&
    pack.instanceKey === state.data.selection.activeInstanceKey
  );
}

export function deriveLibraryPackInteraction(pack, state) {
  const active = isActivePack(pack, state);
  const pending = state.pendingLibraryPackId === pack.id;
  const unavailable = (state.busy && !state.libraryActivationInProgress) || pack.status === "missing";
  const favoriteDisabled = Boolean(
    state.busy ||
    !state.data?.session?.hasSession ||
    pack.favoriteDisabled ||
    pack.duplicatePackId
  );

  return { active, favoriteDisabled, pending, unavailable };
}

function setOptionalAttribute(element, name, value) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function syncLibraryPackCardSelection(card, pack, state) {
  const interaction = deriveLibraryPackInteraction(pack, state);

  card.classList.toggle("pack-card--active", interaction.active);
  card.classList.toggle("pack-card--pending", interaction.pending);
  card.dataset.selected = interaction.active ? "true" : "false";
  card.setAttribute("aria-current", interaction.active ? "true" : "false");
  setOptionalAttribute(card, "aria-busy", interaction.pending ? "true" : null);

  if (interaction.active) {
    for (const attribute of ["aria-disabled", "data-action", "data-pack-id", "role"]) {
      card.removeAttribute(attribute);
    }
    card.setAttribute("tabindex", "-1");
  } else if (interaction.unavailable) {
    card.removeAttribute("data-action");
    card.removeAttribute("data-pack-id");
    card.removeAttribute("role");
    card.removeAttribute("tabindex");
    card.setAttribute("aria-disabled", "true");
  } else {
    card.removeAttribute("aria-disabled");
    card.setAttribute("data-action", "use-library-pack");
    card.setAttribute("data-pack-id", String(pack.id || ""));
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
  }

  const favorite = card.querySelector('[data-action="toggle-library-favorite"]');
  if (favorite) {
    const active = Boolean(pack.favorite);
    const blocked = !state.data?.session?.hasSession || pack.favoriteDisabled || pack.duplicatePackId;
    const label = blocked
      ? "Inicia sesión para marcar favoritos"
      : active ? "Quitar de favoritos" : "Marcar como favorito";
    favorite.disabled = interaction.favoriteDisabled;
    favorite.classList.toggle("favorite-slot--active", active);
    favorite.classList.toggle("favorite-slot--locked", Boolean(blocked));
    favorite.classList.toggle("favorite-slot--pending", Boolean(pack.favoritePending));
    favorite.setAttribute("aria-label", label);
    favorite.setAttribute("aria-pressed", active ? "true" : "false");
    favorite.setAttribute("title", label);
    const iconName = active ? "star-filled" : "star-empty";
    if (favorite.querySelector(".ui-icon")?.dataset.icon !== iconName) {
      favorite.innerHTML = renderIcon(iconName, { className: "favorite-icon", size: "sm" });
    }
  }

  return interaction;
}

export function syncLibraryPackSelectionState(region, state) {
  const packs = state.data?.library?.packs || [];
  const packsByInstanceKey = new Map(packs.map((pack) => [String(pack.instanceKey || ""), pack]));
  let synchronized = 0;

  for (const card of region.querySelectorAll(".pack-card[data-instance-key]")) {
    const pack = packsByInstanceKey.get(card.dataset.instanceKey || "");
    if (!pack) continue;
    syncLibraryPackCardSelection(card, pack, state);
    synchronized += 1;
  }

  return synchronized;
}

export function libraryPacksStructuralState(state) {
  const packs = state.data?.library?.packs || [];
  if (packs.length === 0) return state;
  const favoritesOnly = state.libraryFavoriteFilter === "favorites"
    && Boolean(state.data?.session?.hasSession);

  return {
    ...state,
    busy: false,
    libraryActivationInProgress: false,
    pendingLibraryPackId: null,
    data: {
      ...state.data,
      library: {
        ...state.data.library,
        packs: favoritesOnly
          ? packs
          : packs.map((pack) => ({ ...pack, favorite: false, favoritePending: false })),
      },
      selection: {
        ...state.data.selection,
        activeInstanceKey: null,
      },
    },
  };
}
