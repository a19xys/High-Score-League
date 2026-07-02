import { escapeHtml } from "./html.js";

export const ICONS = Object.freeze({
  add: { fallback: "+", file: "add.svg" },
  app: { fallback: "HSL", file: "app.svg" },
  "arrow-down": { fallback: "↓", file: "arrow-down.svg" },
  "arrow-up": { fallback: "↑", file: "arrow-up.svg" },
  calendar: { fallback: "S", file: "calendar.svg" },
  check: { fallback: "OK", file: "check.svg" },
  "chevron-right": { fallback: ">", file: "chevron-right.svg" },
  close: { fallback: "x", file: "close.svg" },
  connection: { fallback: "*", file: "connection.svg" },
  developer: { fallback: "D", file: "developer.svg" },
  email: { fallback: "@", file: "email.svg" },
  error: { fallback: "!", file: "error.svg" },
  filter: { fallback: "F", file: "filter.svg" },
  "forget-account": { fallback: "x", file: "forget-account.svg" },
  folder: { fallback: "D", file: "folder.svg" },
  genre: { fallback: "G", file: "genre.svg" },
  info: { fallback: "i", file: "info.svg" },
  import: { fallback: "I", file: "import.svg" },
  library: { fallback: "L", file: "library.svg" },
  logout: { fallback: ">", file: "logout.svg" },
  manual: { fallback: "M", file: "manual.svg" },
  moon: { fallback: "M", file: "moon.svg" },
  password: { fallback: "*", file: "password.svg" },
  play: { fallback: ">", file: "play.svg" },
  playtime: { fallback: "T", file: "playtime.svg" },
  practice: { fallback: "P", file: "practice.svg" },
  ranking: { fallback: "#", file: "ranking.svg" },
  refresh: { fallback: "R", file: "refresh.svg" },
  settings: { fallback: "*", file: "settings.svg" },
  "star-empty": { fallback: "-", file: "star-empty.svg" },
  "star-filled": { fallback: "*", file: "star-filled.svg" },
  "status-offline": { fallback: "*", file: "status-offline.svg" },
  "status-online": { fallback: "*", file: "status-online.svg" },
  "status-reconnecting": { fallback: "*", file: "status-reconnecting.svg" },
  sun: { fallback: "S", file: "sun.svg" },
  "sync-error": { fallback: "!", file: "sync-error.svg" },
  "sync-ok": { fallback: "OK", file: "sync-ok.svg" },
  "sync-pending": { fallback: "UP", file: "sync-pending.svg" },
  user: { fallback: "U", file: "user.svg" },
  "view-covers": { fallback: "C", file: "view-covers.svg" },
  "view-icons": { fallback: "I", file: "view-icons.svg" },
  "view-list": { fallback: "=", file: "view-list.svg" },
  warning: { fallback: "!", file: "warning.svg" },
  year: { fallback: "Y", file: "year.svg" },
});

const ICON_ROOT = "./assets/icons/";
const ICON_MASK_ROOT = "../assets/icons/";
const iconLoadState = globalThis.__hslIconLoadState || {
  loaded: new Set(),
  missing: new Set(),
};

globalThis.__hslIconLoadState = iconLoadState;
globalThis.__hslMarkIconLoaded = (name, image) => {
  iconLoadState.missing.delete(name);
  iconLoadState.loaded.add(name);
  image.parentElement.classList.remove("ui-icon--missing");
  image.parentElement.classList.add("ui-icon--loaded");
};
globalThis.__hslMarkIconMissing = (name, image) => {
  iconLoadState.loaded.delete(name);
  iconLoadState.missing.add(name);
  image.parentElement.classList.remove("ui-icon--loaded");
  image.parentElement.classList.add("ui-icon--missing");
};

function iconMeta(name) {
  return ICONS[name] || ICONS.info;
}

export function iconPath(name) {
  return `${ICON_ROOT}${iconMeta(name).file}`;
}

function iconMaskPath(name) {
  return `${ICON_MASK_ROOT}${iconMeta(name).file}`;
}

export function renderIcon(name, options = {}) {
  const icon = iconMeta(name);
  const id = ICONS[name] ? name : "info";
  const src = iconPath(id);
  const maskSrc = iconMaskPath(id);
  const label = options.label ? String(options.label) : "";
  const fallback = options.fallback ?? icon.fallback;
  const className = options.className ? ` ${escapeHtml(options.className)}` : "";
  const size = options.size ? ` ui-icon--${escapeHtml(options.size)}` : "";
  const aria = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : `aria-hidden="true"`;
  const loadClass = iconLoadState.loaded.has(id)
    ? " ui-icon--loaded"
    : iconLoadState.missing.has(id)
      ? " ui-icon--missing"
      : "";

  return `
    <span class="ui-icon ui-icon--${escapeHtml(id)}${loadClass}${size}${className}" data-icon="${escapeHtml(id)}" style="--icon-url: url('${escapeHtml(maskSrc)}')" ${aria}>
      <span class="ui-icon__glyph"></span>
      <img class="ui-icon__img" src="${escapeHtml(src)}" alt="" loading="lazy" onload="window.__hslMarkIconLoaded('${escapeHtml(id)}', this)" onerror="window.__hslMarkIconMissing('${escapeHtml(id)}', this)">
      <span class="ui-icon__fallback">${escapeHtml(fallback)}</span>
    </span>
  `;
}
