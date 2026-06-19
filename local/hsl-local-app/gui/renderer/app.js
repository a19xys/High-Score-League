import { createStore, appendLog } from "./state.js";
import { COPY } from "./components/copy.js";
import { renderDevTools } from "./components/dev-tools.js";
import { renderGamePanel } from "./components/game-panel.js";
import { renderHeader } from "./components/header.js";
import { renderLogPanel } from "./components/log-panel.js";
import { renderPlayerSummary } from "./components/player-summary.js";
import { renderQueuePanel } from "./components/queue-panel.js";

const root = document.getElementById("app");
const savedTheme = localStorage.getItem("hsl-launcher-theme") || "dark";
const store = createStore({
  busy: false,
  busyLabel: null,
  data: null,
  logs: [],
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
          ${renderDevTools(state)}
        </div>
      </div>
    </main>
  `;
}

async function refreshState() {
  const data = await window.hslLauncher.getState();
  store.setState({ data });
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
    diagnose: ok
      ? "Diagnóstico completado. El launcher puede seguir usándose."
      : "El diagnóstico encontró algo que conviene revisar.",
    logout: ok
      ? "Sesión local cerrada. Tus puntuaciones guardadas no se han borrado."
      : "No se pudo cerrar la sesión local.",
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

function bindActions() {
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const button = target?.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "toggle-theme") {
      store.setState({ theme: store.getState().theme === "dark" ? "light" : "dark" });
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
