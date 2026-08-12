import { renderIcon } from "./components/icon.js";
import {
  deriveLibraryPackStatus,
  LIBRARY_PACK_STATUS_CLASSES,
  LIBRARY_PACK_STATUS_TONES,
} from "./components/library-pack-status.js";

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

function syncLibraryPackFavorite(card, pack, state, interaction) {
  const favorite = card.querySelector('[data-action="toggle-library-favorite"]');
  if (!favorite) return;
  const active = Boolean(pack.favorite);
  const blocked = !state.data?.session?.hasSession || pack.favoriteDisabled || pack.duplicatePackId;
  const label = blocked
    ? "Inicia sesiÃ³n para marcar favoritos"
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

function syncLibraryPackStatus(card, pack) {
  const container = card.querySelector("[data-pack-status]");
  if (!container) return;
  const presentation = deriveLibraryPackStatus(pack);
  container.setAttribute("title", presentation.title);

  const label = container.querySelector("[data-pack-status-label]");
  if (label) {
    for (const className of LIBRARY_PACK_STATUS_CLASSES) label.classList.remove(className);
    label.classList.add(presentation.className);
    label.textContent = presentation.label;
  }

  const beacon = container.querySelector("[data-pack-status-beacon]");
  if (beacon) {
    for (const tone of LIBRARY_PACK_STATUS_TONES) {
      beacon.classList.remove(`status-beacon--${tone}`);
    }
    beacon.classList.add(`status-beacon--${presentation.signalTone}`);
    beacon.setAttribute("aria-label", presentation.label);
  }
}

export function syncLibraryPackCardState(card, pack, state) {
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

  syncLibraryPackFavorite(card, pack, state, interaction);
  syncLibraryPackStatus(card, pack);
  return interaction;
}

export function syncLibraryPackRegionState(region, state, model) {
  if (!region || model?.kind !== "cards") {
    return { ok: false, reason: "not-card-list", synchronized: 0 };
  }

  const expectedPacks = model.groups.flatMap((group) => group.packs);
  const cards = [...region.querySelectorAll(".pack-card[data-instance-key]")];
  const exactTopology = cards.length === expectedPacks.length && cards.every(
    (card, index) => String(card.dataset.instanceKey || "") === String(expectedPacks[index].instanceKey || ""),
  );
  if (!exactTopology) {
    return { ok: false, reason: "dom-topology-mismatch", synchronized: 0 };
  }

  cards.forEach((card, index) => syncLibraryPackCardState(card, expectedPacks[index], state));
  return { ok: true, reason: null, synchronized: cards.length };
}
