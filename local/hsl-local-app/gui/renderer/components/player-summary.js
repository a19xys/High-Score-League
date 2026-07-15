import { getPackLabel, getQueueSummary } from "./copy.js";
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

function formatSession(session, account) {
  if (!session?.hasSession) {
    return {
      badge: "No conectado",
      className: "badge badge-warn",
      description: "Inicia sesión para competir y subir puntuaciones. Las colas locales no se mezclan entre cuentas.",
      title: "Sin cuenta activa",
    };
  }

  return {
    badge: "Cuenta conectada",
    className: session.status === "warning" ? "badge badge-warn" : "badge badge-ok",
    description: session.status === "warning"
      ? "Sesión local activa, pero conviene renovarla pronto."
      : "Sesión local activa. Esta cuenta usa su propia cola local.",
    title: account?.displayName || account?.email || session.email || "Jugador conectado",
  };
}

function renderKnownAccounts(state, accounts) {
  if (!accounts.length) {
    return `
      <div class="account-note">
        <strong>Cuentas recordadas</strong>
        <p>Cuando inicies sesión, este dispositivo recordará solo email y datos de presentación.</p>
      </div>
    `;
  }

  const disabled = state.busy ? "disabled" : "";

  return `
    <div class="known-accounts">
      <strong>Cuentas recordadas</strong>
      <ul>
        ${accounts.map((account) => `
          <li>
            <div class="account-mini-avatar">${escapeHtml(account.initials || "JL")}</div>
            <div class="min-w-0">
              <span>${escapeHtml(account.displayName || account.email || "Cuenta")}</span>
              <small>${account.requiresLogin ? escapeHtml(account.requiresLoginMessage) : account.isActive ? "Cuenta activa" : account.hasSavedSession ? "Cambio rápido disponible" : "Requiere iniciar sesión"}</small>
            </div>
            ${account.isActive
              ? `<span class="badge badge-ok">Activa</span>`
              : `
                <button class="mini-action" type="button" data-action="switch-account" data-user-id="${escapeHtml(account.userId)}" data-email="${escapeHtml(account.email || "")}" ${disabled}>
                  ${account.hasSavedSession && !account.requiresLogin ? "Cambiar" : "Entrar"}
                </button>
                <button class="mini-action muted" type="button" data-action="remove-known-account" data-user-id="${escapeHtml(account.userId)}" ${disabled}>
                  Quitar
                </button>
              `}
          </li>
        `).join("")}
      </ul>
      <p class="account-safety-note">Cerrar sesión o cambiar cuenta no borra puntuaciones locales.</p>
    </div>
  `;
}

function renderAuthControls(state, data) {
  const disabled = state.busy ? "disabled" : "";
  const accounts = data.accounts?.knownAccounts || [];

  const emailValue = state.authEmail ? `value="${escapeHtml(state.authEmail)}"` : "";

  if (state.authFormOpen) {
    return `
    <form class="auth-form" data-auth-form>
      <div>
        <label for="hsl-login-email">Email</label>
        <input id="hsl-login-email" name="email" type="email" autocomplete="username" required ${emailValue} ${disabled}>
      </div>
      <div>
        <label for="hsl-login-password">Contraseña</label>
        <input id="hsl-login-password" name="password" type="password" autocomplete="current-password" required ${disabled}>
      </div>
      ${state.authError ? `<p class="auth-error">${escapeHtml(state.authError)}</p>` : ""}
      <p class="auth-help">Cambiar cuenta requiere iniciar sesión de nuevo. No se guardan contraseñas.</p>
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

  if (data.session?.hasSession) {
    return `
      <div class="account-actions">
        <button class="tool-button" type="button" data-action="add-account" ${disabled}>
          + Añadir cuenta
        </button>
        <button class="tool-button" type="button" data-action="logout" ${disabled}>
          Cerrar sesión
          <small>No borra puntuaciones</small>
        </button>
      </div>
      ${renderKnownAccounts(state, accounts)}
    `;
  }

  return `
    <div class="account-actions">
      <button class="tool-button account-primary" type="button" data-action="show-login" ${disabled}>
        Iniciar sesión
      </button>
      <button class="tool-button" type="button" data-action="add-account" ${disabled}>
        + Añadir cuenta
      </button>
    </div>
    ${renderKnownAccounts(state, accounts)}
  `;
}

export function renderPlayerSummary(state) {
  const data = state.data;

  if (!data) {
    return `<section class="panel player-summary skeleton-panel"></section>`;
  }

  const activeAccount = getActiveAccount(data.accounts, data.session);
  const session = formatSession(data.session, activeAccount);
  const totals = data.queue.totals;

  return `
    <section class="panel player-summary">
      <div class="summary-account">
        <div class="avatar">${escapeHtml(activeAccount?.initials || initialsFromSession(data.session))}</div>
        <div class="min-w-0">
          <span class="${session.className}">${session.badge}</span>
          <h2>${escapeHtml(session.title)}</h2>
          <p>${escapeHtml(session.description)}</p>
        </div>
      </div>

      ${renderAuthControls(state, data)}

      <div class="summary-list">
        <div class="summary-row">
          <span>Puntuaciones pendientes</span>
          <strong>${totals.pending}</strong>
        </div>
        <div class="summary-row">
          <span>Enviadas</span>
          <strong>${totals.sent}</strong>
        </div>
        <div class="summary-row">
          <span>Revisar</span>
          <strong>${totals.failed}</strong>
        </div>
      </div>

      <div class="soft-note">
        <strong>${escapeHtml(getPackLabel(data.bridge))}</strong>
        <p>${escapeHtml(getQueueSummary(data.queue))}</p>
      </div>
    </section>
  `;
}
