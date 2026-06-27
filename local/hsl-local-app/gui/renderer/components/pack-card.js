import { escapeHtml } from "./html.js";

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
  if (active && readiness?.status === "ready") return { className: "badge-ok", label: "Pack listo" };
  if (active && readiness?.status === "blocked") return { className: "badge-error", label: "Requiere atención" };
  if (active && readiness?.status === "warning") return { className: "badge-warn", label: "Listo con avisos" };
  if (pack.status === "error") return { className: "badge-error", label: "Requiere atención" };
  if (pack.deprecated) return { className: "badge-warn", label: "Legacy" };
  if (pack.status === "warning") return { className: "badge-warn", label: "Con avisos" };
  if (pack.status === "missing") return { className: "badge-warn", label: "No disponible" };
  return { className: "badge-ok", label: "Instalado" };
}

function subtitleForPack(pack) {
  const season = pack.seasonName || pack.seasonId;
  const week = pack.weekNumber ? `Semana ${pack.weekNumber}` : pack.subtitle || pack.weekId;

  return [season, week].filter(Boolean).join(" · ") || pack.rom || "Pack local";
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

function renderBadges(pack, active, readiness) {
  const meta = statusMeta(pack, active, readiness);
  const badges = [
    active ? `<span class="badge badge-accent">Activo</span>` : "",
    `<span class="badge ${meta.className}">${escapeHtml(meta.label)}</span>`,
  ].filter(Boolean);

  return `<div class="pack-card__badges">${badges.join("")}</div>`;
}

function renderMetadata(pack, view) {
  if (view === "icons") {
    return "";
  }

  const details = [
    pack.developer || pack.publisher,
    pack.year ? String(pack.year) : null,
    ...(pack.genre || []).slice(0, view === "list" ? 2 : 1),
  ].filter(Boolean);

  return details.length ? `<p class="pack-card__metadata">${escapeHtml(details.join(" · "))}</p>` : "";
}

export function renderPackCard(pack, state, view = "covers") {
  const active = isActivePack(pack, state.data);
  const disabled = state.busy || active || pack.status === "error" || pack.status === "missing" ? "disabled" : "";
  const buttonLabel = active ? "Activo" : "Seleccionar";
  const cardClass = `pack-card pack-card--${view}${active ? " pack-card--active" : ""}`;

  return `
    <article class="${cardClass}" title="${escapeHtml(pack.title || "Pack local")}">
      <button class="favorite-slot" type="button" disabled title="Favoritos pendiente" aria-label="Favoritos pendiente">☆</button>
      ${renderPackVisual(pack, view)}
      <div class="pack-card__body">
        ${renderBadges(pack, active, state.data?.readiness)}
        <div class="pack-card__text">
          <h3>${escapeHtml(pack.title || "Pack local")}</h3>
          <p>${escapeHtml(subtitleForPack(pack))}</p>
          ${renderMetadata(pack, view)}
        </div>
        <button class="tool-button library-use-button" type="button" data-action="use-library-pack" data-pack-id="${escapeHtml(pack.id)}" ${disabled}>
          ${buttonLabel}
        </button>
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
