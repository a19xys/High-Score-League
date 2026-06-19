import { createStore, appendLog } from "./state.js";
import { COPY } from "./components/copy.js";
import { renderDevTools } from "./components/dev-tools.js";
import { renderGamePanel } from "./components/game-panel.js";
import { renderHeader } from "./components/header.js";
import { renderLibraryPanel } from "./components/library-panel.js";
import { renderLogPanel } from "./components/log-panel.js";
import { renderPlayerSummary } from "./components/player-summary.js";
import { renderQueuePanel } from "./components/queue-panel.js";

const root = document.getElementById("app");
const savedTheme = localStorage.getItem("hsl-launcher-theme") || "dark";
const store = createStore({
  authError: null,
  authFormOpen: false,
  busy: false,
  busyLabel: null,
  data: null,
  logs: [],
  noticeIds: [],
  theme: savedTheme,
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("hsl-launcher-theme", theme);
}

function render() {
  const state = store.getState();
  applyTheme(state.theme);

  root.innerHTML = `
    ${renderHeader(state)}
    <main>
      <div class="launcher-layout">
        <div class="main-column">
          ${renderGamePanel(state)}
          ${renderQueuePanel(state)}
          ${renderLogPanel(state)}
        </div>
        <div class="side-column">
          ${renderPlayerSummary(state)}
          ${renderLibraryPanel(state)}
          ${renderDevTools(state)}
        </div>
      </div>
    </main>
  `;
}

async function refreshState() {
  const data = await window.hslLauncher.getState();
  const current = store.getState();
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
    logs: noticeLogs.reduce((logs, notice) => appendLog(logs, notice), current.logs),
    noticeIds: [
      ...current.noticeIds,
      ...(data.notices || []).map((notice) => notice.id),
    ],
  });
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
      ? "Pack abierto correctamente. Cambiar de pack no borra puntuaciones locales."
      : "No se pudo abrir el pack seleccionado."),
    "open-membership-url": response.summary || (ok
      ? "Web abierta en el navegador."
      : "No se pudo abrir la web."),
    "add-library-location": response.summary || "Biblioteca actualizada.",
    "remove-library-location": response.summary || "Biblioteca actualizada.",
    "use-library-pack": response.summary || (ok
      ? "Pack activado desde biblioteca."
      : "No se pudo activar el pack desde biblioteca."),
    "play-competition": ok
      ? "MAME se cerró correctamente. La cola local se ha actualizado."
      : "MAME terminó con aviso. Si jugaste una partida, revisa la cola local.",
    practice: ok
      ? "Práctica cerrada. No se activó el plugin de puntuación desde el launcher."
      : "La práctica terminó con aviso.",
    refresh: "Estado local actualizado.",
    "submit-all": ok
      ? "Subida finalizada. Si había puntuaciones válidas, se movieron a enviadas."
      : "No se pudo completar la subida. Tus puntuaciones siguen guardadas localmente.",
    "restore-failed": ok
      ? "Puntuacion restaurada a pendientes. Puedes reintentar cuando el problema este corregido."
      : "No se pudo restaurar la puntuacion.",
    "submit-all-with-failed": "Hay puntuaciones en Requieren atencion. No se han perdido y puedes restaurarlas a pendientes.",
    "sync-plugin": ok
      ? "Plugin sincronizado con el pack de desarrollo."
      : "No se pudo sincronizar el plugin de desarrollo.",
  };

  return {
    details,
    ok,
    summary: friendly[response.action] || (ok ? "Acción completada." : "La acción necesita revisión."),
    title,
  };
}

async function runAction(action, busyLabel, title, fn) {
  if (store.getState().busy) return;

  store.setState({ busy: true, busyLabel });

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

function bindActions() {
  root.addEventListener("submit", (event) => {
    const form = event.target instanceof Element ? event.target.closest("[data-auth-form]") : null;
    if (!form) return;

    event.preventDefault();
    submitLogin(form);
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const button = target?.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "toggle-theme") {
      store.setState({ theme: store.getState().theme === "dark" ? "light" : "dark" });
    }

    if (action === "show-login") {
      store.setState({ authError: null, authFormOpen: true });
    }

    if (action === "cancel-login") {
      store.setState({ authError: null, authFormOpen: false });
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

    if (action === "add-library-location") {
      runAction(action, "Añadiendo ubicación", "Añadir ubicación", () => window.hslLauncher.addLibraryLocation());
    }

    if (action === "remove-library-location") {
      const locationId = button.dataset.locationId;
      runAction(action, "Quitando ubicación", "Quitar ubicación", () => window.hslLauncher.removeLibraryLocation(locationId));
    }

    if (action === "use-library-pack") {
      const packId = button.dataset.packId;
      runAction(action, "Activando pack", "Usar pack de biblioteca", () => window.hslLauncher.useLibraryPack(packId));
    }

    if (action === "open-membership-url") {
      runAction(action, "Abriendo web", "Abrir temporada en la web", () => window.hslLauncher.openMembershipUrl());
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
