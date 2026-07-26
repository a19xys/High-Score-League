const REQUIRED_PHASES = Object.freeze(["theme", "shell", "localState", "library", "selection", "criticalAssets"]);
const SATISFIED = new Set(["ready", "fallback", "degraded", "error", "timeout"]);
const DEGRADED = new Set(["degraded", "error", "timeout"]);

export function classifyStartupSnapshot(data) {
  const library = data?.library;
  let libraryPhase = "error";
  if (library) {
    libraryPhase = ["missing", "inaccessible"].includes(library.status) ? "degraded" : "ready";
  }
  let selectionPhase = "error";
  if (library) {
    if (library.status !== "available-populated") {
      selectionPhase = "fallback";
    } else {
      const active = data.selection?.activeInstanceKey;
      selectionPhase = active && library.packs?.some((pack) => pack.instanceKey === active)
        ? "ready"
        : "degraded";
    }
  }
  return { library: libraryPhase, selection: selectionPhase };
}

function snapshotState(state) {
  return {
    completedAt: state.completedAt,
    elapsedMs: state.elapsedMs,
    phases: { ...state.phases },
    reason: state.reason,
    status: state.status,
    visible: state.visible,
  };
}

export function createStartupReadiness(options = {}) {
  const clearTimeoutImpl = options.clearTimeoutImpl || globalThis.clearTimeout;
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : 4_000;
  const minVisibleMs = Number.isFinite(options.minVisibleMs) ? options.minVisibleMs : 250;
  const now = options.now || Date.now;
  const notify = options.onChange || (() => {});
  const setTimeoutImpl = options.setTimeoutImpl || globalThis.setTimeout;
  const startedAt = now();
  const state = {
    completedAt: null,
    elapsedMs: 0,
    phases: {
      criticalAssets: "pending",
      library: "pending",
      localState: "pending",
      selection: "pending",
      shell: "pending",
      theme: "ready",
    },
    reason: null,
    status: "bootstrap",
    visible: true,
  };
  let completionTimer = null;
  let timeoutTimer = setTimeoutImpl(() => complete("degraded", "startup-timeout"), maxWaitMs);

  function emit() {
    notify(snapshotState(state));
  }

  function complete(status, reason = null) {
    if (!state.visible) return false;
    if (timeoutTimer !== null) clearTimeoutImpl(timeoutTimer);
    if (completionTimer !== null) clearTimeoutImpl(completionTimer);
    timeoutTimer = null;
    completionTimer = null;
    state.completedAt = now();
    state.elapsedMs = Math.max(0, state.completedAt - startedAt);
    state.reason = reason;
    state.status = status;
    state.visible = false;
    emit();
    return true;
  }

  function evaluate() {
    if (!state.visible || !REQUIRED_PHASES.every((phase) => SATISFIED.has(state.phases[phase]))) return;
    if (completionTimer !== null) return;
    const elapsed = Math.max(0, now() - startedAt);
    const delay = Math.max(0, minVisibleMs - elapsed);
    const status = REQUIRED_PHASES.some((phase) => DEGRADED.has(state.phases[phase])) ? "degraded" : "ready";
    if (delay === 0) {
      complete(status, status === "degraded" ? "local-degraded" : null);
      return;
    }
    completionTimer = setTimeoutImpl(() => complete(status, status === "degraded" ? "local-degraded" : null), delay);
  }

  function mark(phase, value = "ready") {
    if (!REQUIRED_PHASES.includes(phase) || !state.visible) return false;
    if (completionTimer !== null) {
      clearTimeoutImpl(completionTimer);
      completionTimer = null;
    }
    state.phases[phase] = value;
    state.status = "resolving";
    state.elapsedMs = Math.max(0, now() - startedAt);
    emit();
    evaluate();
    return true;
  }

  function dispose() {
    if (timeoutTimer !== null) clearTimeoutImpl(timeoutTimer);
    if (completionTimer !== null) clearTimeoutImpl(completionTimer);
    timeoutTimer = null;
    completionTimer = null;
  }

  return {
    complete,
    dispose,
    getState: () => snapshotState(state),
    mark,
  };
}

export const startupReadinessTestApi = { DEGRADED, REQUIRED_PHASES, SATISFIED };
