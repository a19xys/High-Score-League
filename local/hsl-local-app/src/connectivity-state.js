const ACTIVE_VISIBLE_PROBE_PHASES = new Set(["manual", "retry"]);

function deriveConnectivityDisplayState(state = {}) {
  const reachability = state.reachability || "unknown";
  const probe = state.probe || {};

  if (probe.inFlight === true) {
    if (probe.phase === "startup" && reachability === "unknown") {
      return "connecting";
    }

    if (ACTIVE_VISIBLE_PROBE_PHASES.has(probe.phase)) {
      return "reconnecting";
    }
  }

  return reachability === "connected" ? "connected" : "offline";
}

function isStableConnected(state = {}) {
  return state.reachability === "connected" &&
    deriveConnectivityDisplayState(state) === "connected";
}

function isCommittedConnected(state = {}) {
  return state.reachability === "connected";
}

module.exports = {
  deriveConnectivityDisplayState,
  isCommittedConnected,
  isStableConnected,
};
