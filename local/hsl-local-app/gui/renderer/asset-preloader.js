const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 1000;

export function createAssetPreloader({
  clearTimeoutImpl = globalThis.clearTimeout,
  createImage = () => new Image(),
  failureTtlMs = FAILURE_TTL_MS,
  maxEntries = 128,
  now = Date.now,
  setTimeoutImpl = globalThis.setTimeout,
  successTtlMs = SUCCESS_TTL_MS,
  timeoutMs = 1_200,
} = {}) {
  const cache = new Map();
  const activeLoads = new Set();
  let disposed = false;

  function prune() {
    const current = now();
    for (const [url, entry] of cache) {
      if (!entry.result) continue;
      const ttl = entry.result.status === "loaded" ? successTtlMs : failureTtlMs;
      if (current - entry.settledAt > ttl) cache.delete(url);
    }
    while (cache.size > maxEntries) {
      const settledKey = [...cache].find(([, entry]) => entry.result)?.[0];
      if (!settledKey) break;
      cache.delete(settledKey);
    }
  }

  function preload(url, options = {}) {
    const safeUrl = typeof url === "string" ? url.trim() : "";
    if (!safeUrl) return Promise.resolve({ status: "missing", url: null });
    if (disposed) return Promise.resolve({ status: "cancelled", url: safeUrl });
    prune();
    const cached = cache.get(safeUrl);
    if (cached?.promise) return cached.promise;
    if (cached?.result) {
      cache.delete(safeUrl);
      cache.set(safeUrl, cached);
      return Promise.resolve(cached.result);
    }

    const image = createImage();
    let timer = null;
    let settled = false;
    let finish;
    const load = { cancel: () => finish("cancelled"), image, url: safeUrl };
    const promise = new Promise((resolve) => {
      finish = (status) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeoutImpl(timer);
        timer = null;
        image.onload = null;
        image.onerror = null;
        if (["timeout", "cancelled"].includes(status)) {
          try { image.src = ""; } catch {}
        }
        activeLoads.delete(load);
        const result = { status, url: safeUrl };
        if (status !== "cancelled") cache.set(safeUrl, { result, settledAt: now() });
        else cache.delete(safeUrl);
        prune();
        resolve(result);
      };
      image.onload = () => finish("loaded");
      image.onerror = () => finish("error");
      timer = setTimeoutImpl(() => finish("timeout"), Math.max(1, options.timeoutMs || timeoutMs));
      activeLoads.add(load);
      image.src = safeUrl;
    });
    cache.set(safeUrl, { promise, settledAt: now() });
    return promise;
  }

  function preloadAll(urls, options = {}) {
    return Promise.all([...new Set((urls || []).filter(Boolean))].map((url) => preload(url, options)));
  }

  function dispose() {
    disposed = true;
    for (const load of [...activeLoads]) load.cancel();
    activeLoads.clear();
    cache.clear();
  }

  return {
    dispose,
    getDiagnostics: () => ({ activeLoads: activeLoads.size, cacheEntries: cache.size, disposed }),
    preload,
    preloadAll,
    prune,
  };
}

export function assetIdentityMatches(element, current = {}) {
  if (!element?.dataset) return false;
  return String(element.dataset.assetGeneration || "") === String(current.generation ?? "") &&
    String(element.dataset.assetKind || "") === String(current.kind || "") &&
    String(element.dataset.assetSelection || "") === String(current.selection || "") &&
    String(element.dataset.assetUrl || "") === String(current.url || "");
}

export const assetPreloaderTestApi = { FAILURE_TTL_MS, SUCCESS_TTL_MS };
