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

  const activeName = bridge.activePackName;
  const activeWeek = data.game?.weekId;

  if (activeName && pack.packId && activeName === pack.packId) {
    return true;
  }

  return Boolean(activeName && activeWeek && activeName === pack.gameId && activeWeek === pack.weekId);
}

function statusMeta(pack, active, readiness) {
  if (active && readiness?.status === "blocked") return { className: "badge-error", icon: "error", label: "Con errores" };
  if (active) return { className: "badge-accent", icon: "check", label: "Activa" };
  if (pack.status === "error") return { className: "badge-error", icon: "error", label: "Con errores" };
  if (pack.status === "missing") return { className: "badge-warn", icon: "warning", label: "Inactiva" };
  if (pack.status === "warning" && !pack.deprecated) return { className: "badge-warn", icon: "warning", label: "Con avisos" };
  return { className: "badge-ok", icon: "check", label: "Instalado" };
}

function subtitleForPack(pack) {
  const season = pack.seasonName || null;
  const week = pack.weekNumber ? `Semana ${pack.weekNumber}` : null;

  return pack.subtitle || [season, week].filter(Boolean).join(" · ") || "Pack local";
}

function visualAsset(pack, view) {
  if (view === "covers") return pack.cover || pack.icon || pack.logo;
  return pack.icon || pack.cover || pack.logo;
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

function renderFavorite(pack, disabled) {
  const favorite = Boolean(pack.favorite);
  const label = favorite ? "Quitar de favoritos" : "Marcar como favorito";

  return `
    <button class="favorite-slot ${favorite ? "favorite-slot--active" : ""}" type="button" data-action="toggle-library-favorite" data-pack-key="${escapeHtml(pack.favoriteKey || pack.id)}" title="${label}" aria-label="${label}" aria-pressed="${favorite ? "true" : "false"}" ${disabled ? "disabled" : ""}>
      ${renderIcon(favorite ? "star" : "star-empty", { className: "favorite-icon", size: "sm" })}
    </button>
  `;
}

function renderBadges(pack, active, readiness) {
  const meta = statusMeta(pack, active, readiness);
  const legacy = pack.deprecated ? `<span class="badge badge-muted pack-card__legacy">Legacy</span>` : "";

  return `
    <div class="pack-card__status">
      <span class="badge ${meta.className}">${renderIcon(meta.icon, { className: "status-icon", size: "sm" })}${escapeHtml(meta.label)}</span>
      ${legacy}
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
  const disabled = state.busy || active || pack.status === "error" || pack.status === "missing";
  const selectableAttributes = disabled
    ? `aria-disabled="true"`
    : `data-action="use-library-pack" data-pack-id="${escapeHtml(pack.id)}" tabindex="0" role="button"`;
  const cardClass = `pack-card pack-card--${view}${active ? " pack-card--active" : ""}`;
  const subtitle = subtitleForPack(pack);

  return `
    <article class="${cardClass}" title="${escapeHtml(`${pack.title || "Pack local"} · ${subtitle}`)}" ${selectableAttributes}>
      ${renderFavorite(pack, state.busy)}
      ${renderBadges(pack, active, state.data?.readiness)}
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
