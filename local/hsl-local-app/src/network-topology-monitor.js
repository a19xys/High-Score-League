const crypto = require("node:crypto");
const os = require("node:os");

const DEFAULT_TOPOLOGY_POLL_INTERVAL_MS = 1000;

function normalizeAddress(address = {}) {
  return {
    address: String(address.address || ""),
    cidr: String(address.cidr || ""),
    family: String(address.family || ""),
    internal: address.internal === true,
    netmask: String(address.netmask || ""),
    scopeid: Number.isFinite(address.scopeid) ? address.scopeid : null,
  };
}

function buildTopologySnapshot(interfaces = {}) {
  const normalized = Object.entries(interfaces || {})
    .map(([name, addresses]) => ({
      addresses: (Array.isArray(addresses) ? addresses : [])
        .map(normalizeAddress)
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      name: String(name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const serialized = JSON.stringify(normalized);
  const addresses = normalized.flatMap((item) => item.addresses);

  return {
    externalAddressCount: addresses.filter((item) => !item.internal).length,
    fingerprintHash: crypto.createHash("sha256").update(serialized).digest("hex"),
    interfaceCount: normalized.length,
  };
}

function createNetworkTopologyMonitor(options = {}) {
  const intervalMs = options.intervalMs || DEFAULT_TOPOLOGY_POLL_INTERVAL_MS;
  const networkInterfaces = options.networkInterfaces || os.networkInterfaces;
  const now = options.now || Date.now;
  const setIntervalImpl = options.setInterval || setInterval;
  const clearIntervalImpl = options.clearInterval || clearInterval;
  let timer = null;
  let lastSnapshot = null;
  let generation = 0;
  let probeCount = 0;
  let lastProbeAt = null;
  let lastChangeAt = null;
  let lastError = null;

  function poll() {
    probeCount += 1;
    lastProbeAt = new Date(now()).toISOString();
    let snapshot;
    try {
      snapshot = buildTopologySnapshot(networkInterfaces());
      lastError = null;
    } catch (error) {
      lastError = error?.code || error?.name || "network-interfaces-error";
      return getDiagnostics();
    }

    if (!lastSnapshot) {
      lastSnapshot = snapshot;
      return getDiagnostics();
    }
    if (snapshot.fingerprintHash === lastSnapshot.fingerprintHash) return getDiagnostics();

    const previous = lastSnapshot;
    lastSnapshot = snapshot;
    generation += 1;
    lastChangeAt = lastProbeAt;
    options.onChange?.({
      detectedAt: lastChangeAt,
      generation,
      previous,
      snapshot,
    });
    return getDiagnostics();
  }

  function start() {
    if (timer !== null) return;
    poll();
    timer = setIntervalImpl(poll, intervalMs);
    timer?.unref?.();
  }

  function stop() {
    if (timer !== null) clearIntervalImpl(timer);
    timer = null;
  }

  function getDiagnostics() {
    return {
      externalAddressCount: lastSnapshot?.externalAddressCount ?? null,
      interfaceCount: lastSnapshot?.interfaceCount ?? null,
      lastError,
      lastTopologyChangeAt: lastChangeAt,
      lastTopologyProbeAt: lastProbeAt,
      running: timer !== null,
      topologyFingerprintHash: lastSnapshot?.fingerprintHash || null,
      topologyGeneration: generation,
      topologyPollIntervalMs: intervalMs,
      topologyProbeCount: probeCount,
    };
  }

  return { getDiagnostics, poll, start, stop };
}

module.exports = {
  DEFAULT_TOPOLOGY_POLL_INTERVAL_MS,
  buildTopologySnapshot,
  createNetworkTopologyMonitor,
};
