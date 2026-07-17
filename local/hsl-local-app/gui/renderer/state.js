export function createStore(initialState) {
  let state = { ...initialState, rendererStateRevision: Number(initialState?.rendererStateRevision) || 0 };
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(nextState) {
      state = {
        ...state,
        ...nextState,
        rendererStateRevision: state.rendererStateRevision + 1,
      };

      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function appendLog(logs, entry) {
  return [
    {
      at: new Date().toISOString(),
      ...entry,
    },
    ...logs,
  ].slice(0, 20);
}
