function disabledAttr(state) {
  return state.busy ? "disabled" : "";
}

export function renderActionPanel(state) {
  const disabled = disabledAttr(state);
  const hasPending = (state.data?.queue?.totals?.pending || 0) > 0;
  const syncDisabled = state.busy || !state.data?.bridge?.devBridge ? "disabled" : "";

  return `
    <section class="panel action-panel">
      <div class="panel-heading">
        <div>
          <h2>Acciones</h2>
          <p>Flujo minimo del jugador local.</p>
        </div>
      </div>
      <div class="action-grid">
        <button class="command-button primary" type="button" data-action="play" ${disabled}>
          <span>Jugar competicion</span>
          <small>MAME con plugin hsl-score</small>
        </button>
        <button class="command-button" type="button" data-action="practice" ${disabled}>
          <span>Practicar</span>
          <small>MAME sin plugin explicito</small>
        </button>
        <button class="command-button" type="button" data-action="diagnose" ${disabled}>
          <span>Diagnosticar</span>
          <small>Config, MAME, eventos y sesion</small>
        </button>
        <button class="command-button" type="button" data-action="submit" ${disabled || !hasPending ? "disabled" : ""}>
          <span>Enviar pendientes</span>
          <small>${hasPending ? `${state.data.queue.totals.pending} eventos` : "Sin pending"}</small>
        </button>
        <button class="command-button" type="button" data-action="sync-plugin" ${syncDisabled}>
          <span>Sync plugin</span>
          <small>Solo desarrollo puente</small>
        </button>
        <button class="command-button subtle" type="button" data-action="logout" ${disabled}>
          <span>Cerrar sesion local</span>
          <small>No borra eventos</small>
        </button>
      </div>
    </section>
  `;
}
