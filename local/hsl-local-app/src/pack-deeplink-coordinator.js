const crypto = require("node:crypto");
const { isRemotePackId } = require("./pack-deeplink");

const MAX_PENDING_PACK_IMPORTS = 8;

function createPackDeepLinkCoordinator(options = {}) {
  const createId = options.createId || crypto.randomUUID;
  const now = options.now || (() => new Date().toISOString());
  const onAvailable = typeof options.onAvailable === "function" ? options.onAvailable : () => {};
  const queue = [];
  let rendererReady = false;

  function notifyIfAvailable() {
    if (rendererReady && queue.length > 0) onAvailable();
  }

  function enqueue(value) {
    const packId = typeof value === "string" ? value : value?.packId;
    if (!isRemotePackId(packId)) return { accepted: false, reason: "invalid" };
    const existing = queue.find((intent) => intent.packId === packId);
    if (existing) return { accepted: false, intent: { ...existing }, reason: "duplicate" };
    if (queue.length >= MAX_PENDING_PACK_IMPORTS) return { accepted: false, reason: "capacity" };

    const intent = Object.freeze({
      createdAt: now(),
      intentId: createId(),
      packId,
    });
    queue.push(intent);
    notifyIfAvailable();
    return { accepted: true, intent: { ...intent }, reason: null };
  }

  function peek() {
    return queue[0] ? { ...queue[0] } : null;
  }

  function consume(intentId) {
    if (!queue[0] || queue[0].intentId !== intentId) return false;
    queue.shift();
    notifyIfAvailable();
    return true;
  }

  function markRendererReady() {
    rendererReady = true;
    notifyIfAvailable();
  }

  function markRendererUnavailable() {
    rendererReady = false;
  }

  function inspect() {
    return {
      count: queue.length,
      packIds: queue.map((intent) => intent.packId),
      rendererReady,
    };
  }

  return {
    cancel: consume,
    complete: consume,
    enqueue,
    inspect,
    markRendererReady,
    markRendererUnavailable,
    peek,
  };
}

module.exports = {
  MAX_PENDING_PACK_IMPORTS,
  createPackDeepLinkCoordinator,
};
