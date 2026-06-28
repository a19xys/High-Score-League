import { createStore, appendLog } from "./state.js";
import { COPY } from "./components/copy.js";
import { renderDevTools } from "./components/dev-tools.js";
import { renderGamePanel } from "./components/game-panel.js";
import { renderHeader } from "./components/header.js";
import { renderIcon } from "./components/icon.js";
import { renderLibraryPanel } from "./components/library-panel.js";
import { renderLogPanel } from "./components/log-panel.js";
import { renderActivityDrawer } from "./components/queue-panel.js";

const root = document.getElementById("app");
const savedTheme = localStorage.getItem("hsl-launcher-theme") || "dark";
const LIBRARY_SIDEBAR_MIN = 360;
const LIBRARY_SIDEBAR_MAX = 600;
const LIBRARY_SIDEBAR_DEFAULT = 440;
const LAUNCHER_VERSION = "v1.0.0";
const store = createStore({
  accountMenuOpen: false,
  activeOverlay: null,
  authError: null,
  authEmail: "",
  authFormOpen: false,
  busy: false,
  busyLabel: null,
  connectionStatus: navigator.onLine === false ? "offline" : "connected",
  data: null,
  libraryQuery: "",
  librarySeason: "all",
  librarySidebarWidth: LIBRARY_SIDEBAR_DEFAULT,
  libraryStatus: "all",
  libraryView: "covers",
  logs: [],
  noticeIds: [],
  theme: savedTheme,
});

let sidebarResize = null;

function clampSidebarWidth(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return LIBRARY_SIDEBAR_DEFAULT;
  }

  return Math.min(LIBRARY_SIDEBAR_MAX, Math.max(LIBRARY_SIDEBAR_MIN, Math.round(numeric)));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("hsl-launcher-theme", theme);
}

function renderOverlay(state) {
  if (!state.activeOverlay) {
    return "";
  }

  const isActivity = state.activeOverlay === "activity";

  return `
    <div class="modal-layer" data-overlay-backdrop>
      <aside class="drawer-layer" role="dialog" aria-modal="true" aria-label="${isActivity ? "Actividad local" : "Opciones avanzadas"}" data-drawer>
        <div class="drawer-header">
          <div>
            <p class="eyebrow">${isActivity ? "Cola local" : "Soporte"}</p>
            <h2>${isActivity ? "Actividad local" : "Opciones avanzadas"}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-overlay" title="Cerrar">x</button>
        </div>
        <div class="drawer-body">
          ${isActivity ? renderActivityDrawer(state) : `
            <p class="advanced-shell__intro">Runtime MAME, directorio de packs, readiness, diagnóstico y herramientas legacy.</p>
            <div class="advanced-grid">
              ${renderDevTools(state)}
              ${renderLogPanel(state)}
            </div>
          `}
        </div>
      </aside>
    </div>
  `;
}

function renderStatusFooter() {
  return `
    <footer class="launcher-footer" aria-label="Estado del launcher">
      <span class="launcher-footer__status">
        ${renderIcon("check", { className: "footer-status-icon", size: "sm" })}
        <span>Launcher actualizado</span>
      </span>
      <span class="launcher-footer__version">${LAUNCHER_VERSION}</span>
    </footer>
  `;
}

function render() {
  const state = store.getState();
  applyTheme(state.theme);
  const sidebarWidth = clampSidebarWidth(state.librarySidebarWidth);

  root.innerHTML = `
    ${renderHeader(state)}
    <main class="app-main" style="--library-sidebar-width: ${sidebarWidth}px">
      <aside class="library-panel-region">
        <div class="library-scroll">
          ${renderLibraryPanel(state)}
        </div>
      </aside>
      <div class="library-resizer" data-sidebar-resizer role="separator" aria-orientation="vertical" aria-label="Ajustar anchura de biblioteca" tabindex="0"></div>
      <section class="game-panel-region">
        <div class="game-scroll">
          ${renderGamePanel(state)}
        </div>
      </section>
    </main>
    ${renderStatusFooter()}
    ${renderOverlay(state)}
  `;
}

async function refreshState() {
  const data = await window.hslLauncher.getState();
  const current = store.getState();
  const libraryPreferences = data.library?.preferences || {};
  const noticeLogs = (data.notices || [])
    .filter((notice) => !current.noticeIds.includes(notice.id))
    .map((notice) => ({
      details: notice.details || [],
      ok: notice.level !== "warning",
      summary: notice.summary,
      title: "Pack recordado",
    }));

  store.setState({
    data,
    librarySidebarWidth: clampSidebarWidth(libraryPreferences.sidebarWidth || current.librarySidebarWidth),
    libraryView: libraryPreferences.libraryView || current.libraryView,
    logs: noticeLogs.reduce((logs, notice) => appendLog(logs, notice), current.logs),
    noticeIds: [
      ...current.noticeIds,
      ...(data.notices || []).map((notice) => notice.id),
    ],
  });
}

async function persistLibraryPreferences(patch) {
  try {
    const response = await window.hslLauncher.setLibraryPreferences(patch);

    if (response.state) {
      const preferences = response.state.library?.preferences || {};
      store.setState({
        data: response.state,
        librarySidebarWidth: clampSidebarWidth(preferences.sidebarWidth || store.getState().librarySidebarWidth),
        libraryView: preferences.libraryView || store.getState().libraryView,
      });
    }
  } catch (error) {
    store.setState({
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudieron guardar las preferencias de biblioteca.",
        title: "Biblioteca",
      }),
    });
  }
}

async function toggleLibraryFavorite(packKey) {
  try {
    const response = await window.hslLauncher.toggleLibraryFavorite(packKey);

    if (response.state) {
      store.setState({ data: response.state });
    }
  } catch (error) {
    store.setState({
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudo actualizar el favorito.",
        title: "Biblioteca",
      }),
    });
  }
}

function updateSidebarWidth(width, save = false) {
  const nextWidth = clampSidebarWidth(width);

  store.setState({ librarySidebarWidth: nextWidth });

  if (save) {
    persistLibraryPreferences({ sidebarWidth: nextWidth });
  }
}

function resultToLog(title, response) {
  const lines = response.lines || [];
  const extra = response.report
    ? [
        `Errores: ${response.report.errorCount}`,
        `Advertencias: ${response.report.warningCount}`,
        ...response.report.recommendations.slice(0, 3),
      ]
    : [];
  const ok = response.ok !== false && response.exitCode !== 1;
  const details = [...lines, ...extra];
  const friendly = {
    login: ok
      ? "Login correcto."
      : "No he podido iniciar sesión. Revisa email y contraseña.",
    diagnose: ok
      ? "Diagnóstico completado. El launcher puede seguir usándose."
      : "El diagnóstico encontró algo que conviene revisar.",
    logout: ok
      ? "Sesión local cerrada. Tus puntuaciones guardadas no se han borrado."
      : "No se pudo cerrar la sesión local.",
    "open-pack": response.summary || (ok
      ? "Pack cargado. Cambiar de pack no borra puntuaciones locales."
      : "No se pudo abrir el pack seleccionado."),
    "open-membership-url": response.summary || (ok
      ? "Web abierta en el navegador."
      : "No se pudo abrir la web."),
    "choose-pack-directory": response.summary || "Directorio de packs actualizado.",
    "choose-shared-mame-runtime": response.summary || "Runtime MAME actualizado.",
    "check-membership": response.summary || "Comprobacion de temporada actualizada.",
    "open-pack-directory": response.summary || "Directorio de packs abierto.",
    "open-manual": response.summary || (ok ? "Manual abierto." : "Este pack todavia no incluye manual local."),
    "open-ranking": response.summary || (ok ? "Ranking abierto en la web." : "Ranking integrado pendiente."),
    "open-shared-mame-runtime": response.summary || "Carpeta MAME abierta.",
    "remove-known-account": response.summary || (ok
      ? "Cuenta quitada de este dispositivo. No se han borrado puntuaciones locales."
      : "No se pudo quitar la cuenta recordada."),
    "use-library-pack": response.summary || (ok
      ? "Pack activado desde biblioteca."
      : "No se pudo activar el pack desde biblioteca."),
    "play-competition": ok
      ? "MAME se cerro correctamente. La cola local se ha actualizado."
      : "MAME termino con aviso. Si jugaste una partida, revisa la cola local.",
    practice: ok
      ? "Práctica cerrada. No se activó el plugin de puntuación desde el launcher."
      : "La práctica terminó con aviso.",
    refresh: "Estado local actualizado.",
    "rescan-pack-directory": response.summary || "Biblioteca reescaneada.",
    "submit-all": ok
      ? "Subida finalizada. Si había puntuaciones válidas, se movieron a enviadas."
      : "No se pudo completar la subida. Tus puntuaciones siguen guardadas localmente.",
    "restore-failed": ok
      ? "Puntuación restaurada a pendientes. Puedes reintentar cuando el problema esté corregido."
      : "No se pudo restaurar la puntuación.",
    "submit-all-with-failed": "Hay puntuaciones que requieren atención. No se han perdido y puedes restaurarlas a pendientes.",
    "sync-plugin": ok
      ? "Plugin sincronizado con el pack de desarrollo."
      : "No se pudo sincronizar el plugin de desarrollo.",
    "switch-account": response.summary || (ok
      ? "Cuenta cambiada. La cola visible corresponde a esta cuenta y pack."
      : "No se pudo cambiar de cuenta."),
    "switch-account-login-required": response.summary || "Inicia sesión de nuevo para esta cuenta.",
  };

  return {
    details,
    ok,
    summary: friendly[response.action] || (ok ? "Accion completada." : "La accion necesita revision."),
    title,
  };
}

async function runAction(action, busyLabel, title, fn) {
  if (store.getState().busy) return;

  store.setState({ accountMenuOpen: false, busy: true, busyLabel });

  try {
    const response = await fn();
    const statePatch = {
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, resultToLog(title, response)),
    };

    if (response.state) {
      statePatch.data = response.state;
    }

    store.setState(statePatch);
  } catch (error) {
    store.setState({
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "La acción no pudo completarse. Si había puntuaciones, siguen en la cola local.",
        title,
      }),
    });
  }
}

async function submitLogin(form) {
  if (store.getState().busy) return;

  const fields = new FormData(form);
  const email = String(fields.get("email") || "").trim();
  const password = String(fields.get("password") || "");

  store.setState({ authError: null, busy: true, busyLabel: "Conectando" });

  try {
    const response = await window.hslLauncher.login(email, password);

    store.setState({
      authError: response.ok ? null : response.summary || "No he podido iniciar sesión.",
      authEmail: response.ok ? "" : email,
      authFormOpen: !response.ok,
      busy: false,
      busyLabel: null,
      data: response.state || store.getState().data,
      logs: appendLog(store.getState().logs, resultToLog("Iniciar sesión", response)),
    });
  } catch {
    store.setState({
      authError: "No he podido iniciar sesión. Revisa email y contraseña.",
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [],
        ok: false,
        summary: "No he podido iniciar sesión. Revisa email y contraseña.",
        title: "Iniciar sesión",
      }),
    });
  }
}

async function switchAccount(button) {
  if (store.getState().busy) return;

  const email = button.dataset.email || "";
  const userId = button.dataset.userId;

  if (!userId) {
    store.setState({ authEmail: email, authError: null, authFormOpen: true });
    return;
  }

  store.setState({ busy: true, busyLabel: "Cambiando cuenta" });

  try {
    const response = await window.hslLauncher.switchAccount(userId);
    const nextState = {
      busy: false,
      busyLabel: null,
      data: response.state || store.getState().data,
      logs: appendLog(store.getState().logs, resultToLog("Cambiar cuenta", response)),
    };

    if (response.requiresLogin) {
      nextState.authEmail = response.email || email;
      nextState.authError = response.summary || "Inicia sesión de nuevo para esta cuenta.";
      nextState.authFormOpen = true;
    } else {
      nextState.authEmail = "";
      nextState.authError = null;
      nextState.authFormOpen = false;
    }

    store.setState(nextState);
  } catch (error) {
    store.setState({
      authEmail: email,
      authError: "No se pudo cambiar de cuenta. Inicia sesión de nuevo.",
      authFormOpen: true,
      busy: false,
      busyLabel: null,
      logs: appendLog(store.getState().logs, {
        details: [error.message || String(error)],
        ok: false,
        summary: "No se pudo cambiar de cuenta.",
        title: "Cambiar cuenta",
      }),
    });
  }
}

function bindActions() {
  root.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-library-search]") : null;
    if (!input) return;

    const cursor = input.selectionStart;
    store.setState({ libraryQuery: input.value });
    const nextInput = root.querySelector("[data-library-search]");

    if (nextInput instanceof HTMLInputElement) {
      nextInput.focus();

      if (Number.isInteger(cursor)) {
        nextInput.setSelectionRange(cursor, cursor);
      }
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;

    if (target.matches("[data-library-season]")) {
      store.setState({ librarySeason: target.value });
    }

  });

  root.addEventListener("pointerdown", (event) => {
    const resizer = event.target instanceof Element ? event.target.closest("[data-sidebar-resizer]") : null;

    if (!resizer) return;

    event.preventDefault();
    sidebarResize = {
      startX: event.clientX,
      startWidth: clampSidebarWidth(store.getState().librarySidebarWidth),
    };
    document.body.classList.add("is-resizing-library");
  });

  window.addEventListener("pointermove", (event) => {
    if (!sidebarResize) return;

    updateSidebarWidth(sidebarResize.startWidth + event.clientX - sidebarResize.startX);
  });

  window.addEventListener("pointerup", () => {
    if (!sidebarResize) return;

    sidebarResize = null;
    document.body.classList.remove("is-resizing-library");
    persistLibraryPreferences({ sidebarWidth: store.getState().librarySidebarWidth });
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const resizer = target?.closest("[data-sidebar-resizer]");

    if (resizer && (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home")) {
      event.preventDefault();
      const current = store.getState().librarySidebarWidth;
      const delta = event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : LIBRARY_SIDEBAR_DEFAULT - current;
      updateSidebarWidth(current + delta, true);
      return;
    }

    const card = target?.closest("[role='button'][data-action='use-library-pack']");

    if (card && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      card.click();
    }
  });

  root.addEventListener("submit", (event) => {
    const form = event.target instanceof Element ? event.target.closest("[data-auth-form]") : null;
    if (!form) return;

    event.preventDefault();
    submitLogin(form);
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const current = store.getState();

    if (target?.matches("[data-overlay-backdrop]")) {
      store.setState({ activeOverlay: null });
      return;
    }

    if (
      current.accountMenuOpen &&
      target &&
      !target.closest("[data-account-menu]") &&
      !target.closest("[data-action='toggle-account-menu']")
    ) {
      store.setState({ accountMenuOpen: false });
    }

    const button = target?.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "toggle-theme") {
      store.setState({ theme: store.getState().theme === "dark" ? "light" : "dark" });
    }

    if (action === "toggle-account-menu") {
      store.setState({ accountMenuOpen: !store.getState().accountMenuOpen });
    }

    if (action === "show-activity-details") {
      store.setState({ accountMenuOpen: false, activeOverlay: "activity" });
    }

    if (action === "close-overlay") {
      store.setState({ activeOverlay: null });
    }

    if (action === "set-library-view") {
      const libraryView = button.dataset.view || "covers";
      store.setState({ libraryView });
      persistLibraryPreferences({ libraryView });
    }

    if (action === "toggle-library-favorite") {
      event.preventDefault();
      event.stopPropagation();
      toggleLibraryFavorite(button.dataset.packKey || "");
    }

    if (action === "show-login") {
      store.setState({ accountMenuOpen: true, authEmail: "", authError: null, authFormOpen: true });
    }

    if (action === "add-account") {
      store.setState({ accountMenuOpen: true, authEmail: "", authError: null, authFormOpen: true });
    }

    if (action === "switch-account") {
      switchAccount(button);
    }

    if (action === "cancel-login") {
      store.setState({ authEmail: "", authError: null, authFormOpen: false });
    }

    if (action === "refresh") {
      runAction("refresh", "Actualizando", COPY.actions.refresh, async () => {
        const data = await window.hslLauncher.getState();
        return {
          action: "refresh",
          lines: ["Estado local actualizado."],
          ok: true,
          state: data,
        };
      });
    }

    if (action === "open-pack") {
      runAction(action, "Abriendo pack", COPY.actions.openPack, () => window.hslLauncher.openPack());
    }

    if (action === "choose-pack-directory") {
      runAction(action, "Eligiendo directorio", "Elegir directorio", () => window.hslLauncher.choosePackDirectory());
    }

    if (action === "choose-shared-mame-runtime") {
      runAction(action, "Eligiendo MAME", "Elegir mame.exe", () => window.hslLauncher.chooseSharedMameRuntime());
    }

    if (action === "open-pack-directory") {
      runAction(action, "Abriendo directorio", "Abrir directorio", () => window.hslLauncher.openPackDirectory());
    }

    if (action === "open-shared-mame-runtime") {
      runAction(action, "Abriendo MAME", "Abrir carpeta MAME", () => window.hslLauncher.openSharedMameRuntime());
    }

    if (action === "rescan-pack-directory") {
      runAction(action, "Reescaneando", "Reescanear", () => window.hslLauncher.rescanPackDirectory());
    }

    if (action === "use-library-pack") {
      const packId = button.dataset.packId;
      runAction(action, "Activando pack", "Usar pack de biblioteca", () => window.hslLauncher.useLibraryPack(packId));
    }

    if (action === "open-membership-url") {
      runAction(action, "Abriendo web", "Abrir temporada en la web", () => window.hslLauncher.openMembershipUrl());
    }

    if (action === "open-manual") {
      runAction(action, "Abriendo manual", "Ver manual", () => window.hslLauncher.openManual());
    }

    if (action === "open-ranking") {
      runAction(action, "Abriendo ranking", "Ver ranking", () => window.hslLauncher.openRanking());
    }

    if (action === "check-membership") {
      runAction(action, "Comprobando temporada", "Comprobar de nuevo", () => window.hslLauncher.checkMembership());
    }

    if (action === "diagnose") {
      runAction(action, "Diagnosticando", COPY.actions.diagnose, () => window.hslLauncher.diagnose());
    }

    if (action === "play") {
      runAction(action, "Abriendo competición", COPY.actions.play, () => window.hslLauncher.playCompetition());
    }

    if (action === "practice") {
      runAction(action, "Abriendo práctica", COPY.actions.practice, () => window.hslLauncher.practice());
    }

    if (action === "submit") {
      runAction(action, "Subiendo puntuaciones", COPY.actions.submit, () => window.hslLauncher.submitAll());
    }

    if (action === "restore-failed") {
      const filename = button.dataset.filename;
      runAction(action, "Restaurando", "Restaurar a pendientes", () => window.hslLauncher.restoreFailed(filename));
    }

    if (action === "remove-known-account") {
      const userId = button.dataset.userId;
      runAction(action, "Quitando cuenta", "Quitar cuenta", () => window.hslLauncher.removeKnownAccount(userId));
    }

    if (action === "sync-plugin") {
      runAction(action, "Sincronizando plugin", COPY.actions.syncPlugin, () => window.hslLauncher.syncPlugin());
    }

    if (action === "logout") {
      runAction(action, "Cerrando sesión", COPY.actions.logout, () => window.hslLauncher.logout());
    }
  });
}

store.subscribe(render);
render();
bindActions();
window.addEventListener("keydown", (event) => {
  if (event.key === "D" && event.ctrlKey && event.shiftKey) {
    event.preventDefault();
    store.setState({ accountMenuOpen: false, activeOverlay: "advanced" });
    return;
  }

  if (event.key !== "Escape") return;

  const state = store.getState();

  if (state.activeOverlay || state.accountMenuOpen) {
    store.setState({ activeOverlay: null, accountMenuOpen: false });
  }
});
window.addEventListener("offline", () => store.setState({ connectionStatus: "offline" }));
window.addEventListener("online", () => {
  store.setState({ connectionStatus: "reconnecting" });
  window.setTimeout(() => store.setState({ connectionStatus: "connected" }), 800);
});
refreshState().catch((error) => {
  store.setState({
    logs: appendLog(store.getState().logs, {
      details: [error.message || String(error)],
      ok: false,
      summary: "No se pudo leer el estado local inicial.",
      title: "Carga inicial",
    }),
  });
});
