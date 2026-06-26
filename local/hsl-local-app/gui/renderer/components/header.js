import { COPY } from "./copy.js";
import { escapeHtml } from "./html.js";

function initialsFromSession(session) {
  const value = session?.email || session?.userId || "Jugador";
  return value
    .split(/[@.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase())
    .join("") || "JL";
}

function getActiveAccount(accounts, session) {
  return accounts?.knownAccounts?.find((account) => account.isActive) || (
    session?.hasSession
      ? {
          email: session.email,
          initials: initialsFromSession(session),
          userId: session.userId,
        }
      : null
  );
}

function renderKnownAccount(account, disabled) {
  if (account.isActive) {
    return `
      <li>
        <div class="account-mini-avatar">${escapeHtml(account.initials || "JL")}</div>
        <div class="min-w-0">
          <span>${escapeHtml(account.displayName || account.email || "Cuenta")}</span>
          <small>Cuenta activa</small>
        </div>
        <span class="badge badge-ok">Activa</span>
      </li>
    `;
  }

  return `
    <li>
      <div class="account-mini-avatar">${escapeHtml(account.initials || "JL")}</div>
      <div class="min-w-0">
        <span>${escapeHtml(account.displayName || account.email || "Cuenta")}</span>
        <small>${account.hasSavedSession ? "Cambio rapido disponible" : "Requiere iniciar sesion"}</small>
      </div>
      <button class="mini-action" type="button" data-action="switch-account" data-user-id="${escapeHtml(account.userId)}" data-email="${escapeHtml(account.email || "")}" ${disabled}>
        ${account.hasSavedSession ? "Cambiar" : "Entrar"}
      </button>
      <button class="mini-action muted" type="button" data-action="remove-known-account" data-user-id="${escapeHtml(account.userId)}" ${disabled}>
        Quitar
      </button>
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
    <form class="auth-form auth-form--menu" data-auth-form>
      <div>
        <label for="hsl-login-email">Email</label>
        <input id="hsl-login-email" name="email" type="email" autocomplete="username" required ${emailValue} ${disabled}>
      </div>
      <div>
        <label for="hsl-login-password">Contrasena</label>
        <input id="hsl-login-password" name="password" type="password" autocomplete="current-password" required ${disabled}>
      </div>
      ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ""}
      <p class="auth-help">No se guardan contrasenas ni se mezclan colas locales.</p>
      <div class="form-actions">
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
  const session = data?.session;
  const accounts = data?.accounts?.knownAccounts || [];
  const activeAccount = getActiveAccount(data?.accounts, session);
  const title = activeAccount?.displayName || activeAccount?.email || session?.email || "Sin cuenta activa";
  const subtitle = session?.hasSession
    ? "Las puntuaciones se guardan por cuenta y pack."
    : "Inicia sesion para competir y subir puntuaciones.";

  return `
    <div class="account-menu" data-account-menu>
      <div class="account-menu__active">
        <div class="avatar avatar--compact">${escapeHtml(activeAccount?.initials || initialsFromSession(session))}</div>
        <div class="min-w-0">
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </div>
      <div class="account-menu__actions">
        <button class="tool-button account-primary" type="button" data-action="add-account" ${disabled}>
          ${session?.hasSession ? "+ Anadir cuenta" : "Iniciar sesion"}
        </button>
        ${session?.hasSession ? `
          <button class="tool-button" type="button" data-action="logout" ${disabled}>
            Cerrar sesion
            <small>No borra puntuaciones</small>
          </button>
        ` : ""}
      </div>
      ${renderAuthForm(state)}
      <div class="known-accounts known-accounts--menu">
        <strong>Cuentas recordadas</strong>
        ${accounts.length
          ? `<ul>${accounts.map((account) => renderKnownAccount(account, disabled)).join("")}</ul>`
          : `<p class="account-safety-note">Este dispositivo recordara solo datos de presentacion cuando inicies sesion.</p>`}
        <p class="account-safety-note">Cambiar o cerrar sesion no borra puntuaciones locales.</p>
      </div>
    </div>
  `;
}

export function renderHeader(state) {
  const themeLabel = state.theme === "dark" ? "Claro" : "Oscuro";
  const busyText = state.busy ? `<span class="busy-chip">${escapeHtml(state.busyLabel || "Ejecutando")}</span>` : "";
  const session = state.data?.session;
  const activeAccount = getActiveAccount(state.data?.accounts, session);
  const sessionText = session?.hasSession
    ? activeAccount?.displayName || session.email || "Cuenta conectada"
    : "Sin cuenta conectada";
  const sessionInitials = activeAccount?.initials || initialsFromSession(session);
  const connection = {
    connected: ["Conectado", "connection-chip--connected"],
    offline: ["Sin Internet", "connection-chip--offline"],
    reconnecting: ["Reconectando", "connection-chip--reconnecting"],
  }[state.connectionStatus] || ["Conectado", "connection-chip--connected"];

  return `
    <header class="launcher-header app-header">
      <div>
        <p class="eyebrow">HSL</p>
        <h1>High Score League Launcher</h1>
        <p class="header-subtitle">${COPY.launcherSubtitle}</p>
      </div>
      <div class="header-actions">
        ${busyText}
        <span class="connection-chip ${connection[1]}"><i aria-hidden="true"></i>${connection[0]}</span>
        <button class="icon-button" type="button" data-action="refresh" title="Actualizar estado">&#8635;</button>
        <button class="theme-button" type="button" data-action="toggle-theme">${themeLabel}</button>
        <div class="account-menu-shell">
          <button class="session-chip session-chip--button" type="button" data-action="toggle-account-menu" aria-expanded="${state.accountMenuOpen ? "true" : "false"}">
            <span class="account-mini-avatar">${escapeHtml(sessionInitials)}</span>
            <span>${escapeHtml(sessionText)}</span>
          </button>
          ${state.accountMenuOpen ? renderAccountMenu(state) : ""}
        </div>
      </div>
    </header>
  `;
}
