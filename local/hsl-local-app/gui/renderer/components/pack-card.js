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
  if (active && readiness?.status === "ready") {
    return { className: "badge-ok", label: "Listo para jugar" };
  }

  if (active && readiness?.status === "blocked") {
    return { className: "badge-error", label: "Requiere atencion" };
  }

  if (active && readiness?.status === "warning") {
    return { className: "badge-warn", label: "Listo con avisos" };
  }

  if (pack.status === "error") {
    return { className: "badge-error", label: "Requiere atencion" };
  }

  if (pack.status === "warning") {
    return { className: "badge-warn", label: "Con avisos" };
  }

  if (pack.status === "missing") {
    return { className: "badge-warn", label: "No disponible" };
  }

  return { className: "badge-ok", label: "Listo" };
}

function subtitleForPack(pack) {
  if (pack.subtitle) {
    return pack.subtitle;
  }

  if (pack.weekId) {
    return `Semana ${pack.weekId}`;
  }

  return pack.rom || "Pack local";
}

function renderPackVisual(pack) {
  const asset = pack.cover || pack.icon || pack.logo;

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
    pack.weekId ? `<span class="badge badge-muted">${escapeHtml(pack.weekId)}</span>` : "",
    pack.rom ? `<span class="badge badge-muted">${escapeHtml(pack.rom)}</span>` : "",
  ].filter(Boolean);

  return `<div class="pack-card__badges">${badges.join("")}</div>`;
}

export function renderPackCard(pack, state) {
  const active = isActivePack(pack, state.data);
  const disabled = state.busy || active || pack.status === "error" || pack.status === "missing" ? "disabled" : "";
  const buttonLabel = active ? "Ya activo" : "Usar este pack";
  const cardClass = active ? "pack-card pack-card--active" : "pack-card";
  const issueCopy = pack.status === "error"
    ? `<p class="pack-card__issue">Este pack necesita revision.</p>`
    : "";

  return `
    <article class="${cardClass}">
      ${renderPackVisual(pack)}
      <div class="pack-card__body">
        ${renderBadges(pack, active, state.data?.readiness)}
        <div class="pack-card__text">
          <h3>${escapeHtml(pack.title || "Pack local")}</h3>
          <p>${escapeHtml(subtitleForPack(pack))}</p>
        </div>
        ${issueCopy}
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
};
