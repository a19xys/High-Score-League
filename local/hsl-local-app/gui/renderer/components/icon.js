import { escapeHtml } from "./html.js";

export const ICONS = Object.freeze({
  add: { fallback: "+", file: "add.svg" },
  app: { fallback: "HSL", file: "app.svg" },
  calendar: { fallback: "S", file: "calendar.svg" },
  check: { fallback: "OK", file: "check.svg" },
  close: { fallback: "x", file: "close.svg" },
  connection: { fallback: "*", file: "connection.svg" },
  developer: { fallback: "D", file: "developer.svg" },
  email: { fallback: "@", file: "email.svg" },
  error: { fallback: "!", file: "error.svg" },
  "forget-account": { fallback: "x", file: "forget-account.svg" },
  genre: { fallback: "G", file: "genre.svg" },
  info: { fallback: "i", file: "info.svg" },
  logout: { fallback: ">", file: "logout.svg" },
  manual: { fallback: "M", file: "manual.svg" },
  moon: { fallback: "M", file: "moon.svg" },
  password: { fallback: "*", file: "password.svg" },
  play: { fallback: ">", file: "play.svg" },
  playtime: { fallback: "T", file: "playtime.svg" },
  practice: { fallback: "P", file: "practice.svg" },
  ranking: { fallback: "#", file: "ranking.svg" },
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

function iconMeta(name) {
  return ICONS[name] || ICONS.info;
}

export function iconPath(name) {
  return `${ICON_ROOT}${iconMeta(name).file}`;
}

export function renderIcon(name, options = {}) {
  const icon = iconMeta(name);
  const id = ICONS[name] ? name : "info";
  const src = iconPath(id);
  const label = options.label ? String(options.label) : "";
  const fallback = options.fallback ?? icon.fallback;
  const className = options.className ? ` ${escapeHtml(options.className)}` : "";
  const size = options.size ? ` ui-icon--${escapeHtml(options.size)}` : "";
  const aria = label
    ? `role="img" aria-label="${escapeHtml(label)}"`
    : `aria-hidden="true"`;

  return `
    <span class="ui-icon ui-icon--${escapeHtml(id)}${size}${className}" data-icon="${escapeHtml(id)}" ${aria}>
      <img class="ui-icon__img" src="${escapeHtml(src)}" alt="" loading="lazy" onload="this.parentElement.classList.remove('ui-icon--missing');this.parentElement.classList.add('ui-icon--loaded')" onerror="this.parentElement.classList.remove('ui-icon--loaded');this.parentElement.classList.add('ui-icon--missing')">
      <span class="ui-icon__fallback">${escapeHtml(fallback)}</span>
    </span>
  `;
}
