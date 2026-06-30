import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";

function normalizePath(value) {
  return typeof value === "string"
    ? value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    : null;
}

function getInitials(title) {
  const words = String(title || "HSL")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2);
  const initials = words.map((word) => word[0]?.toUpperCase()).join("");

  return initials || "HSL";
}

function isActivePack(pack, data = {}) {
  const bridge = data.bridge || {};
  const packDir = normalizePath(pack?.packDir);
  const activeRoot = normalizePath(bridge.packRoot);

  if (packDir && activeRoot && packDir === activeRoot) {
    return true;
  }

  if (activeRoot) {
    return false;
  }

  const activeName = bridge.activePackName;
  const activeWeek = data.game?.weekId;

  if (activeName && pack.packId && activeName === pack.packId) {
    return true;
  }

  return Boolean(activeName && activeWeek && activeName === pack.gameId && activeWeek === pack.weekId);
}

function statusMeta(pack) {
  if (pack.status === "error") {
    return {
      className: "week-status--error",
      dotClassName: "pack-card__status-dot--error",
      label: "REQUIERE ATENCION",
      title: "Este pack esta incompleto o no es valido.",
    };
  }

  if (pack.deprecated) {
    return {
      className: "week-status--legacy",
      dotClassName: "pack-card__status-dot--warning",
      label: "LEGACY",
      title: "Este pack usa un contrato antiguo.",
    };
  }

  if (pack.status === "warning") {
    return {
      className: "week-status--warning",
      dotClassName: "pack-card__status-dot--warning",
      label: "AVISO",
      title: "Este pack puede usarse, pero tiene avisos.",
    };
  }

  return {
    className: "week-status--ready",
    dotClassName: "pack-card__status-dot--ok",
    label: "LISTO",
    title: "Pack detectado y listo para abrir.",
  };
}

function subtitleForPack(pack) {
  const season = pack.seasonName || null;
  const week = pack.weekNumber ? `Semana ${pack.weekNumber}` : null;

  return pack.subtitle || [season, week].filter(Boolean).join(" · ") || "Pack local";
}

function visualAsset(pack, view) {
  if (view === "covers") return pack.cover || pack.icon;
  return pack.icon || pack.cover;
}

function renderPackVisual(pack, view) {
  const asset = visualAsset(pack, view);

  if (asset?.url) {
    return `
      <div class="pack-card__media has-asset">
        <img src="${escapeHtml(asset.url)}" alt="">
      </div>
    `;
  }

  return `
    <div class="pack-card__media pack-card__placeholder" aria-hidden="true">
      <span>HSL</span>
      <strong>${escapeHtml(getInitials(pack.title))}</strong>
    </div>
  `;
}

function renderFavorite(pack, disabled, hasSession) {
  const favorite = Boolean(pack.favorite);
  const blocked = !hasSession || pack.favoriteDisabled || pack.duplicatePackId;
  const label = blocked
    ? "Inicia sesión para marcar favoritos"
    : favorite ? "Quitar de favoritos" : "Marcar como favorito";

  return `
    <button class="favorite-slot ${favorite ? "favorite-slot--active" : ""} ${blocked ? "favorite-slot--locked" : ""}" type="button" data-action="toggle-library-favorite" data-pack-key="${escapeHtml(pack.favoriteKey || pack.id)}" title="${label}" aria-label="${label}" aria-pressed="${favorite ? "true" : "false"}" ${disabled || blocked ? "disabled" : ""}>
      ${renderIcon(favorite ? "star-filled" : "star-empty", { className: "favorite-icon", size: "sm" })}
    </button>
  `;
}

function renderBadges(pack, view) {
  const meta = statusMeta(pack);

  if (view === "icons") {
    return `
      <div class="pack-card__status pack-card__status--dot" title="${escapeHtml(meta.title)}">
        <span class="pack-card__status-dot ${meta.dotClassName}" aria-label="${escapeHtml(meta.label)}"></span>
      </div>
    `;
  }

  return `
    <div class="pack-card__status" title="${escapeHtml(meta.title)}">
      <span class="badge week-status-badge ${meta.className}">${escapeHtml(meta.label)}</span>
    </div>
  `;
}

function renderMetadata(pack, view) {
  if (view !== "covers") {
    return "";
  }

  const details = [
    pack.developer || pack.publisher,
    pack.year ? String(pack.year) : null,
    ...(pack.genre || []).slice(0, 1),
  ].filter(Boolean);

  return details.length ? `<p class="pack-card__metadata">${escapeHtml(details.join(" · "))}</p>` : "";
}

export function renderPackCard(pack, state, view = "covers") {
  const active = isActivePack(pack, state.data);
  const pending = state.pendingLibraryPackId === pack.id;
  const busyBlocksLibrarySelection = state.busy && !state.libraryActivationInProgress;
  const disabled = busyBlocksLibrarySelection || active || pack.status === "error" || pack.status === "missing";
  const busyAttribute = pending ? `aria-busy="true" ` : "";
  const selectableAttributes = disabled
    ? `${busyAttribute}aria-disabled="true"`
    : `${busyAttribute}data-action="use-library-pack" data-pack-id="${escapeHtml(pack.id)}" tabindex="0" role="button"`;
  const cardClass = `pack-card pack-card--${view}${active ? " pack-card--active" : ""}${pending ? " pack-card--pending" : ""}`;
  const subtitle = subtitleForPack(pack);

  return `
    <article class="${cardClass}" title="${escapeHtml(`${pack.title || "Pack local"} · ${subtitle}`)}" ${selectableAttributes}>
      ${renderFavorite(pack, state.busy, Boolean(state.data?.session?.hasSession))}
      ${renderBadges(pack, view)}
      ${renderPackVisual(pack, view)}
      <div class="pack-card__body">
        <div class="pack-card__text">
          <h3>${escapeHtml(pack.title || "Pack local")}</h3>
          <p class="pack-card__subtitle">${renderIcon("calendar", { className: "status-icon pack-card__subtitle-icon", size: "sm" })}${escapeHtml(subtitle)}</p>
          ${renderMetadata(pack, view)}
        </div>
      </div>
    </article>
  `;
}

export const packCardTestApi = {
  getInitials,
  isActivePack,
  statusMeta,
  subtitleForPack,
  visualAsset,
};
