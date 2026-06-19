import { createStore, appendLog } from "./state.js";
import { renderActionPanel } from "./components/action-panel.js";
import { renderHeader } from "./components/header.js";
import { renderLogPanel } from "./components/log-panel.js";
import { renderQueuePanel } from "./components/queue-panel.js";
import { renderStatusGrid } from "./components/status-card.js";

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
      ${renderStatusGrid(state)}
      <div class="main-grid">
        <div class="left-column">
          ${renderActionPanel(state)}
          ${renderQueuePanel(state)}
        </div>
        ${renderLogPanel(state)}
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

  return {
    lines: [...lines, ...extra],
    ok: response.ok !== false && response.exitCode !== 1,
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
        lines: [error.message || String(error)],
        ok: false,
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
      runAction("refresh", "Actualizando", "Actualizar estado", async () => {
        const data = await window.hslLauncher.getState();
        return {
          lines: ["Estado local actualizado."],
          ok: true,
          state: data,
        };
      });
    }

    if (action === "diagnose") {
      runAction(action, "Diagnosticando", "Diagnostico", () => window.hslLauncher.diagnose());
    }

    if (action === "play") {
      runAction(action, "MAME competicion", "Jugar competicion", () => window.hslLauncher.playCompetition());
    }

    if (action === "practice") {
      runAction(action, "MAME practica", "Practicar", () => window.hslLauncher.practice());
    }

    if (action === "submit") {
      runAction(action, "Enviando pending", "Enviar pendientes", () => window.hslLauncher.submitAll());
    }

    if (action === "sync-plugin") {
      runAction(action, "Sincronizando plugin", "Sync plugin", () => window.hslLauncher.syncPlugin());
    }

    if (action === "logout") {
      runAction(action, "Cerrando sesion", "Cerrar sesion", () => window.hslLauncher.logout());
    }
  });
}

store.subscribe(render);
render();
bindActions();
refreshState().catch((error) => {
  store.setState({
    logs: appendLog(store.getState().logs, {
      lines: [error.message || String(error)],
      ok: false,
      title: "Carga inicial",
    }),
  });
});
