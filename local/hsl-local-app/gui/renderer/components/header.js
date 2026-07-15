import { COPY } from "./copy.js";
import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";
import { deriveConnectivityHeaderState } from "../connectivity-header-state.js";

const NO_SESSION_LABEL = "No has iniciado sesión";
const SESSION_CHIP_EMPTY_LABEL = "Sin sesión";

function initialsFromValue(value) {
  const source = String(value || "").trim();

  if (!source) {
    return "";
  }

  return source
    .split(/[@.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase())
    .join("") || "";
}

function getActiveAccount(accounts, session) {
  return accounts?.knownAccounts?.find((account) => account.isActive) || (
    session?.hasSession
      ? {
          email: session.email,
          initials: initialsFromValue(session.email || session.userId),
          userId: session.userId,
        }
      : null
  );
}

function accountTitle(account) {
  return account?.displayName || account?.email || NO_SESSION_LABEL;
}

function accountSubtitle(account) {
  const title = accountTitle(account);
  const email = account?.email || "";

  return email && email !== title ? email : "";
}

function accountAriaLabel(account) {
  return account?.email || account?.displayName || NO_SESSION_LABEL;
}

function accountCompactLabel(account) {
  return account?.displayName || account?.initials || initialsFromValue(account?.email || account?.userId) || SESSION_CHIP_EMPTY_LABEL;
}

function renderAccountAvatar(account, className = "") {
  const initials = account?.initials || initialsFromValue(account?.displayName || account?.email || account?.userId);
  const emptyClass = initials ? "" : " account-mini-avatar--empty";
  const content = initials ? escapeHtml(initials) : renderIcon("user", { className: "account-icon", size: "sm" });

  return `<span class="account-mini-avatar ${className}${emptyClass}" aria-hidden="true">${content}</span>`;
}

function renderAccountText(account) {
  const email = account?.email || accountTitle(account);

  return `
    <span class="account-row__text min-w-0">
      <strong class="account-row__email">${escapeHtml(email)}</strong>
    </span>
  `;
}

function renderKnownAccount(account, disabled) {
  const check = account.isActive
    ? renderIcon("check", { className: "account-row__check icon-slot icon-slot--check", label: "Cuenta seleccionada", size: "sm" })
    : `<span class="account-row__check" aria-hidden="true"></span>`;
  const rowContent = `
    ${check}
    ${renderAccountAvatar(account)}
    ${renderAccountText(account)}
  `;
  const forgetButton = `
    <button class="account-forget-button" type="button" data-action="remove-known-account" data-user-id="${escapeHtml(account.userId)}" title="Olvidar cuenta" aria-label="Olvidar cuenta" ${disabled}>
      ${renderIcon("forget-account", { className: "icon-slot icon-slot--forget", size: "sm" })}
    </button>
  `;

  if (account.isActive) {
    return `
      <li class="account-row account-row--active">
        <div class="account-row__surface">
        <div class="account-row__button" aria-current="true" title="${escapeHtml(accountAriaLabel(account))}" aria-label="${escapeHtml(accountAriaLabel(account))}">
          ${rowContent}
        </div>
        ${forgetButton}
        </div>
      </li>
    `;
  }

  return `
    <li class="account-row">
      <div class="account-row__surface">
      <button class="account-row__button" type="button" data-action="switch-account" data-user-id="${escapeHtml(account.userId)}" data-email="${escapeHtml(account.email || "")}" title="${escapeHtml(accountAriaLabel(account))}" aria-label="${escapeHtml(accountAriaLabel(account))}" ${disabled}>
        ${rowContent}
      </button>
      ${forgetButton}
      </div>
    </li>
  `;
}

function renderAuthForm(state) {
  if (!state.authFormOpen) {
    return "";
  }

  const disabled = state.busy ? "disabled" : "";
  const emailValue = state.authEmail ? `value="${escapeHtml(state.authEmail)}"` : "";

  return `
    <form class="auth-form auth-form--menu account-login-form" data-auth-form>
      <label>
        <span>${renderIcon("email", { className: "form-label-icon", size: "sm" })}Email</span>
        <input id="hsl-login-email" name="email" type="email" autocomplete="username" required ${emailValue} ${disabled}>
      </label>
      <label>
        <span>${renderIcon("password", { className: "form-label-icon", size: "sm" })}Contraseña</span>
        <input id="hsl-login-password" name="password" type="password" autocomplete="current-password" required ${disabled}>
      </label>
      ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ""}
      <div class="form-actions form-actions--inline">
        <button class="tool-button account-primary" type="submit" ${disabled}>
          ${state.busy && state.busyLabel === "Conectando" ? "Conectando..." : "Entrar"}
        </button>
        <button class="tool-button" type="button" data-action="cancel-login" ${disabled}>
          Cancelar
        </button>
      </div>
    </form>
  `;
}

function renderAccountMenu(state) {
  const data = state.data;
  const disabled = state.busy ? "disabled" : "";
  const accounts = data?.accounts?.knownAccounts || [];
  const activeAccount = getActiveAccount(data?.accounts, data?.session);
  const activeEmail = activeAccount?.email || "";

  return `
    <div class="account-menu" data-account-menu>
      <div class="account-menu__active">
        ${renderAccountAvatar(activeAccount, "avatar--compact")}
        <div class="min-w-0">
          <strong>${escapeHtml(activeAccount ? accountCompactLabel(activeAccount) : SESSION_CHIP_EMPTY_LABEL)}</strong>
          ${activeEmail ? `<p>${escapeHtml(activeEmail)}</p>` : ""}
        </div>
      </div>
      <div class="known-accounts known-accounts--menu">
        <strong>Cuentas</strong>
        ${accounts.length
          ? `<ul>${accounts.map((account) => renderKnownAccount(account, disabled)).join("")}</ul>`
          : `<p class="account-empty-note">Sin cuentas recordadas.</p>`}
      </div>
      <div class="account-menu__actions">
        <button class="tool-button account-primary icon-slot-button" type="button" data-action="add-account" ${disabled}>
          ${renderIcon("add", { className: "button-icon icon-slot icon-slot--add", size: "sm" })}
          <span>Añadir cuenta</span>
        </button>
      </div>
      ${renderAuthForm(state)}
    </div>
  `;
}

export function renderHeader(state) {
  const themeLabel = state.theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  const themeIcon = state.theme === "dark" ? "moon" : "sun";
  const session = state.data?.session;
  const activeAccount = getActiveAccount(state.data?.accounts, session);
  const sessionChipLabel = session?.hasSession ? accountAriaLabel(activeAccount) : SESSION_CHIP_EMPTY_LABEL;
  const sessionChipContent = session?.hasSession
    ? renderAccountAvatar(activeAccount, "account-chip-avatar")
    : `<span class="session-chip__empty">${SESSION_CHIP_EMPTY_LABEL}</span>`;
  const sessionChipClass = session?.hasSession ? "session-chip--avatar-only" : "session-chip--empty";
  const headerStatus = deriveConnectivityHeaderState(state.connectivity);
  const connection = {
    connected: ["Conectado", "connection-chip--connected"],
    offline: ["Desconectado", "connection-chip--offline"],
  }[headerStatus];
  const manualProbeInFlight = state.connectivity?.probe?.phase === "manual" && state.connectivity?.probe?.inFlight;
  const silentBackground = state.connectivity?.probe?.phase === "background" && state.connectivity?.probe?.inFlight;
  const connectionChip = connection ? `
        <div class="connection-chip ${connection[1]}" data-connectivity-status="${headerStatus}">
          <span class="connection-dot" aria-hidden="true"></span>
          <span class="connection-label" aria-live="${silentBackground ? "off" : "polite"}" aria-atomic="true">${connection[0]}</span>
          <button class="connection-refresh-button" type="button" data-action="refresh-connectivity" title="Comprobar conexi\u00f3n" aria-label="Comprobar conexi\u00f3n" aria-disabled="${manualProbeInFlight ? "true" : "false"}" ${manualProbeInFlight ? "disabled" : ""}>${renderIcon("refresh", { className: "connection-refresh-icon", size: "sm" })}</button>
        </div>
  ` : "";

  return `
    <header class="launcher-header app-header">
      <div class="brand-lockup">
        <div class="app-icon-slot" aria-hidden="true">${renderIcon("app", { className: "app-brand-icon", size: "lg" })}</div>
        <div class="min-w-0">
          <h1>High Score League Launcher</h1>
          <p class="header-subtitle">${COPY.launcherSubtitle}</p>
        </div>
      </div>
      <div class="header-actions">
        ${connectionChip}
        <button class="theme-button theme-button--icon" type="button" data-action="toggle-theme" title="${themeLabel}" aria-label="${themeLabel}">
          ${renderIcon(themeIcon, { className: "button-icon theme-icon", size: "sm" })}
        </button>
        <button class="theme-button theme-button--icon" type="button" data-action="show-settings" title="Configuracion" aria-label="Configuracion">
          ${renderIcon("settings", { className: "button-icon settings-icon", size: "sm" })}
        </button>
        <div class="account-menu-shell">
          <button class="session-chip session-chip--button ${sessionChipClass}" type="button" data-action="toggle-account-menu" aria-expanded="${state.accountMenuOpen ? "true" : "false"}" title="${escapeHtml(sessionChipLabel)}" aria-label="${escapeHtml(sessionChipLabel)}">
            ${sessionChipContent}
          </button>
          ${state.accountMenuOpen ? renderAccountMenu(state) : ""}
        </div>
      </div>
    </header>
  `;
}
