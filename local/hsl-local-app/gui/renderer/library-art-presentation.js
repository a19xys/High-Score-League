export const LIBRARY_ART_ALPHA_THRESHOLD = 224;
export const LIBRARY_ART_CACHE_LIMIT = 128;
export const LIBRARY_ART_MAX_ANALYSIS_SIZE = 64;
export const LIBRARY_ART_MIN_EXTERIOR_PIXELS = 4;
export const LIBRARY_ART_MIN_EXTERIOR_RATIO = 0.02;

const PRESENTATIONS = new Set(["opaque", "transparent", "unknown"]);

function normalizedPresentation(value) {
  return PRESENTATIONS.has(value) ? value : "unknown";
}

export function classifyExteriorTransparency(imageData, options = {}) {
  const width = Number(imageData?.width) || 0;
  const height = Number(imageData?.height) || 0;
  const pixels = imageData?.data;
  const total = width * height;
  if (!pixels || width < 1 || height < 1 || pixels.length < total * 4) return "unknown";

  const alphaThreshold = options.alphaThreshold ?? LIBRARY_ART_ALPHA_THRESHOLD;
  const minimumPixels = options.minimumPixels ?? LIBRARY_ART_MIN_EXTERIOR_PIXELS;
  const minimumRatio = options.minimumRatio ?? LIBRARY_ART_MIN_EXTERIOR_RATIO;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let exteriorTransparentPixels = 0;

  const enqueue = (index) => {
    if (visited[index] || pixels[index * 4 + 3] > alphaThreshold) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    exteriorTransparentPixels += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const significantPixelCount = Math.max(minimumPixels, Math.ceil(total * minimumRatio));
  return exteriorTransparentPixels >= significantPixelCount ? "transparent" : "opaque";
}

function assetUrlForImage(image) {
  return String(image?.dataset?.assetUrl || image?.currentSrc || image?.src || "");
}

function isOpaqueByFormat(assetUrl) {
  return /\.jpe?g(?:$|[?#])/i.test(assetUrl);
}

export function classifyImageAlpha(image, options = {}) {
  const assetUrl = options.assetUrl ?? assetUrlForImage(image);
  if (isOpaqueByFormat(assetUrl)) return "opaque";
  const naturalWidth = Number(image?.naturalWidth) || 0;
  const naturalHeight = Number(image?.naturalHeight) || 0;
  if (naturalWidth < 1 || naturalHeight < 1) return "unknown";

  try {
    const canvasFactory = options.canvasFactory || (() => document.createElement("canvas"));
    const canvas = canvasFactory();
    const scale = Math.min(1, LIBRARY_ART_MAX_ANALYSIS_SIZE / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "unknown";
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return classifyExteriorTransparency(context.getImageData(0, 0, width, height), options);
  } catch {
    return "unknown";
  }
}

export function createLibraryArtPresentationCache(options = {}) {
  const limit = Math.max(1, Number(options.limit) || LIBRARY_ART_CACHE_LIMIT);
  const entries = new Map();
  let classifications = 0;
  let evictions = 0;
  let hits = 0;

  return {
    clear() {
      entries.clear();
      classifications = 0;
      evictions = 0;
      hits = 0;
    },
    resolve(assetUrl, classify) {
      const key = String(assetUrl || "");
      if (!key) return "unknown";
      if (entries.has(key)) {
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        hits += 1;
        return value;
      }
      classifications += 1;
      let value = "unknown";
      try {
        value = normalizedPresentation(classify());
      } catch {
        value = "unknown";
      }
      entries.set(key, value);
      while (entries.size > limit) {
        entries.delete(entries.keys().next().value);
        evictions += 1;
      }
      return value;
    },
    stats() {
      return { classifications, evictions, hits, limit, size: entries.size };
    },
  };
}

const libraryArtPresentationCache = createLibraryArtPresentationCache();

export function resolveLibraryArtPresentation(image) {
  const assetUrl = assetUrlForImage(image);
  return libraryArtPresentationCache.resolve(assetUrl, () => classifyImageAlpha(image, { assetUrl }));
}

export function getLibraryArtPresentationCacheStats() {
  return libraryArtPresentationCache.stats();
}
