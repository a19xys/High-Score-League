(function exposeRemoteAvailability(root, factory) {
  const api = factory();
  root.HSLRemoteAvailability = api;
  if (typeof module === "object" && module.exports) module.exports = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  function deriveRemoteAvailability(connectivity) {
    const reachability = connectivity?.reachability;
    const status = reachability === "connected"
      ? "connected"
      : reachability === "offline"
        ? "offline"
        : "unknown";

    return {
      available: status === "connected",
      generation: Number(connectivity?.reachabilityGeneration) || 0,
      reason: status === "connected" ? null : status === "offline" ? "hsl-offline" : "not-confirmed",
      status,
    };
  }

  function deriveRemoteActionAvailability(connectivity, blockers = []) {
    const remote = deriveRemoteAvailability(connectivity);
    const ownBlockers = blockers.filter(Boolean);
    return {
      ...remote,
      available: remote.available && ownBlockers.length === 0,
      blockers: ownBlockers,
    };
  }

  return { deriveRemoteActionAvailability, deriveRemoteAvailability };
}));
