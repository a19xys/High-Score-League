import { escapeHtml } from "./html.js";

export const ICONS = Object.freeze({
  add: { fallback: "+", file: "add.png" },
  app: { fallback: "HSL", file: "app.png" },
  "book-open": { fallback: "M", file: "book-open.png" },
  calendar: { fallback: "S", file: "calendar.png" },
  check: { fallback: "OK", file: "check.png" },
  clock: { fallback: "T", file: "clock.png" },
  close: { fallback: "x", file: "close.png" },
  connection: { fallback: "•", file: "connection.png" },
  download: { fallback: ">", file: "download.png" },
  email: { fallback: "@", file: "email.png" },
  error: { fallback: "!", file: "error.png" },
  "forget-account": { fallback: "x", file: "forget-account.png" },
  genre: { fallback: "G", file: "genre.png" },
  info: { fallback: "i", file: "info.png" },
  logout: { fallback: ">", file: "logout.png" },
  moon: { fallback: "M", file: "moon.png" },
  password: { fallback: "*", file: "password.png" },
  practice: { fallback: "P", file: "practice.png" },
  publisher: { fallback: "D", file: "publisher.png" },
  ranking: { fallback: "#", file: "ranking.png" },
  star: { fallback: "★", file: "star.png" },
  "star-empty": { fallback: "☆", file: "star-empty.png" },
  "status-offline": { fallback: "•", file: "status-offline.png" },
  "status-online": { fallback: "•", file: "status-online.png" },
  "status-reconnecting": { fallback: "•", file: "status-reconnecting.png" },
  sun: { fallback: "S", file: "sun.png" },
  "sync-error": { fallback: "!", file: "sync-error.png" },
  "sync-ok": { fallback: "OK", file: "sync-ok.png" },
  "sync-pending": { fallback: "UP", file: "sync-pending.png" },
  user: { fallback: "U", file: "user.png" },
  "view-covers": { fallback: "C", file: "view-covers.png" },
  "view-icons": { fallback: "I", file: "view-icons.png" },
  "view-list": { fallback: "=", file: "view-list.png" },
  warning: { fallback: "!", file: "warning.png" },
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
    <span class="ui-icon ui-icon--${escapeHtml(id)}${size}${className}" data-icon="${escapeHtml(id)}" style="--icon-url: url('${escapeHtml(src)}')" ${aria}>
      <img class="ui-icon__probe" src="${escapeHtml(src)}" alt="" onload="this.parentElement.classList.add('ui-icon--loaded')" onerror="this.parentElement.classList.add('ui-icon--missing')">
      <span class="ui-icon__mask"></span>
      <span class="ui-icon__fallback">${escapeHtml(fallback)}</span>
    </span>
  `;
}
