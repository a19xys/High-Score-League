import { COPY } from "./copy.js";
import { escapeHtml } from "./html.js";
import { renderIcon } from "./icon.js";
import { renderStatusBeacon } from "./status-primitives.js";
import {
  derivePublicConnectivityPresentation,
  deriveRememberedAccountPresentation,
  deriveSessionPresentation,
  deriveSupportingActions,
} from "../product-presentation.js";

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

export function renderAccountAvatar(account, className = "") {
  const localUrl = typeof account?.avatarLocalUrl === "string" && account.avatarLocalUrl.startsWith("file:///")
    ? account.avatarLocalUrl
    : null;
  const initials = account?.initials || "";
  const emptyClass = localUrl || initials ? "" : " account-mini-avatar--empty";
  const content = localUrl
    ? `<img class="account-mini-avatar__image" src="${escapeHtml(localUrl)}" alt="">`
    : initials
      ? escapeHtml(initials)
      : renderIcon("user", { className: "account-icon", size: "sm" });

  return `<span class="account-mini-avatar ${className}${emptyClass}" aria-hidden="true">${content}</span>`;
}

function renderAccountText(account) {
  const email = account?.email || accountTitle(account);
  const session = deriveRememberedAccountPresentation(account);
  const sessionWarning = session.status !== "available"
    ? `<small class="account-row__session-warning" title="${escapeHtml(session.description)}">${escapeHtml(session.title)}</small>`
    : "";

  return `
    <span class="account-row__text min-w-0">
      <strong class="account-row__email">${escapeHtml(email)}</strong>
      ${sessionWarning}
    </span>
  `;
}

function renderKnownAccount(account, disabled, switchAction) {
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
      <button class="account-row__button" type="button" data-action="switch-account" data-user-id="${escapeHtml(account.userId)}" data-email="${escapeHtml(account.email || "")}" title="${escapeHtml(switchAction.reason || accountAriaLabel(account))}" aria-label="${escapeHtml(accountAriaLabel(account))}" ${!switchAction.available && switchAction.reason ? `aria-describedby="${switchAction.reasonId}" aria-disabled="true"` : ""} ${disabled}>
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
  const loginAction = deriveSupportingActions(state).login;
  const remoteDisabled = loginAction.available ? disabled : "disabled";
  const emailValue = state.authEmail ? `value="${escapeHtml(state.authEmail)}"` : "";
  const errorReference = state.authError ? "aria-describedby=\"hsl-login-error\" aria-invalid=\"true\"" : "";
  const loginBlockReference = !loginAction.available && loginAction.reason
    ? `aria-describedby="${loginAction.reasonId}"`
    : "";

  return `
    <form class="auth-form auth-form--menu account-login-form" data-auth-form>
      <label>
        <span>${renderIcon("email", { className: "form-label-icon", size: "sm" })}Email</span>
        <input id="hsl-login-email" name="email" type="email" autocomplete="username" required ${emailValue} ${errorReference} ${disabled}>
      </label>
      <label>
        <span>${renderIcon("password", { className: "form-label-icon", size: "sm" })}Contraseña</span>
        <input id="hsl-login-password" name="password" type="password" autocomplete="current-password" required ${errorReference} ${disabled}>
      </label>
      ${state.authError ? `<p class="auth-error" id="hsl-login-error" role="alert">${escapeHtml(state.authError)}</p>` : ""}
      ${!loginAction.available && loginAction.reason ? `<p class="auth-availability-reason" id="${loginAction.reasonId}">${escapeHtml(loginAction.reason)}</p>` : ""}
      <div class="form-actions form-actions--inline">
        <button class="tool-button account-primary" type="submit" ${loginBlockReference} ${remoteDisabled}>
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
  const session = deriveSessionPresentation(data?.session, data?.accounts, state);
  const switchAction = deriveSupportingActions(state).switchAccount;

  return `
    <div class="account-menu" data-account-menu>
      <div class="account-menu__active">
        ${renderAccountAvatar(activeAccount, "avatar--compact")}
        <div class="min-w-0">
          <strong>${escapeHtml(activeAccount ? accountCompactLabel(activeAccount) : SESSION_CHIP_EMPTY_LABEL)}</strong>
          ${activeEmail ? `<p>${escapeHtml(activeEmail)}</p>` : ""}
        </div>
      </div>
      ${session.actionRequired === true ? `<p class="account-session-state" data-severity="${escapeHtml(session.severity)}">${escapeHtml(session.title)}</p>` : ""}
      <div class="known-accounts known-accounts--menu">
        <strong>Cuentas</strong>
        ${accounts.length
          ? `<ul>${accounts.map((account) => renderKnownAccount(account, disabled, switchAction)).join("")}</ul>`
          : `<p class="account-empty-note">Sin cuentas recordadas.</p>`}
        ${!switchAction.available && switchAction.reason ? `<p class="sr-only" id="${switchAction.reasonId}">${escapeHtml(switchAction.reason)}</p>` : ""}
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

export function renderThemeControl(state) {
  const themeLabel = state.theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  const themeIcon = state.theme === "dark" ? "moon" : "sun";

  return `
    <button class="theme-button theme-button--icon" type="button" data-action="toggle-theme" title="${themeLabel}" aria-label="${themeLabel}">
      ${renderIcon(themeIcon, { className: "button-icon theme-icon", size: "sm" })}
    </button>
  `;
}

export function renderAccountControl(state) {
  const session = state.data?.session;
  const sessionPresentation = deriveSessionPresentation(session, state.data?.accounts, state);
  const activeAccount = getActiveAccount(state.data?.accounts, session);
  const accountLabel = session?.hasSession ? accountAriaLabel(activeAccount) : SESSION_CHIP_EMPTY_LABEL;
  const sessionChipLabel = `${accountLabel}. ${sessionPresentation.title}`;
  const sessionChipContent = session?.hasSession
    ? renderAccountAvatar(activeAccount, "account-chip-avatar")
    : `<span class="session-chip__empty">${SESSION_CHIP_EMPTY_LABEL}</span>`;
  const sessionChipClass = session?.hasSession ? "session-chip--avatar-only" : "session-chip--empty";

  return `
    <button class="session-chip session-chip--button ${sessionChipClass}" type="button" data-action="toggle-account-menu" aria-expanded="${state.accountMenuOpen ? "true" : "false"}" title="${escapeHtml(sessionChipLabel)}" aria-label="${escapeHtml(sessionChipLabel)}">
      ${sessionChipContent}
    </button>
    ${state.accountMenuOpen ? renderAccountMenu(state) : ""}
  `;
}

export function renderConnectionControl(state) {
  const status = derivePublicConnectivityPresentation(state.connectivity, state.data?.remoteConfiguration);
  const action = deriveSupportingActions(state).refreshConnectivity;
  const committed = status.committed === true;
  const manualProbe = (state.connectivity?.probe?.phase === "manual" && state.connectivity?.probe?.inFlight === true)
    || (state.busy === true && state.busyLabel === "Comprobando conexión");
  const disabled = !committed || !action.available;
  const actionTitle = action.reason || action.label;
  const signalTone = status.status === "connected" ? "success" : "error";

  return `
    <div class="connection-control" data-connectivity-committed="${committed ? "true" : "false"}" ${!committed ? "aria-hidden=\"true\"" : ""}>
      <div class="connection-chip ${committed ? `connection-chip--${escapeHtml(status.status)}` : "connection-chip--unresolved"}"
        ${committed
          ? `data-connectivity-status="${escapeHtml(status.status)}" data-severity="${escapeHtml(status.severity)}" title="${escapeHtml(status.description)}"`
          : "aria-hidden=\"true\""}>
        ${committed ? `
          ${renderStatusBeacon(signalTone, { className: "connection-dot", decorative: true, variant: "connection" })}
          <span class="connection-label">${escapeHtml(status.title)}</span>
        ` : ""}
        <button class="connection-refresh-button" type="button" data-action="refresh-connectivity"
          title="${escapeHtml(actionTitle)}" aria-label="Comprobar conexión" aria-busy="${manualProbe ? "true" : "false"}"
          ${disabled ? "disabled aria-disabled=\"true\"" : ""} ${!committed ? "aria-hidden=\"true\" tabindex=\"-1\"" : ""}>
          ${renderIcon("refresh", { className: "connection-refresh-icon", size: "sm" })}
        </button>
      </div>
    </div>
  `;
}

export function renderHeader(state) {

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
        <span class="render-region-contents" data-render-region="header-connection">${renderConnectionControl(state)}</span>
        <span class="render-region-contents" data-render-region="header-theme">${renderThemeControl(state)}</span>
        <button class="theme-button theme-button--icon" type="button" data-action="show-settings" title="Configuración" aria-label="Configuración">
          ${renderIcon("settings", { className: "button-icon settings-icon", size: "sm" })}
        </button>
        <div class="account-menu-shell" data-render-region="header-account">${renderAccountControl(state)}</div>
      </div>
    </header>
  `;
}
