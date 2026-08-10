const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");
const read = (relativePath) => fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");

function state() {
  return {
    busy: false,
    data: {
      library: { packs: [], preferences: {}, status: "available-populated", totals: { packs: 0 } },
      selection: { activeInstanceKey: null },
      session: { hasSession: true },
    },
    libraryActivationInProgress: false,
    pendingLibraryPackId: null,
  };
}

test("Lista e Iconos render the same source asset while cover fallback stays automatic", async () => {
  const { renderPackCard } = await import(pathToFileURL(path.join(rendererRoot, "components", "pack-card.js")).href);
  const iconPack = {
    cover: { url: "file:///cover.png" },
    icon: { url: "file:///icon.png" },
    id: "icon-pack",
    instanceKey: "icon-pack",
    status: "ok",
    title: "Icon Pack",
  };
  const fallbackPack = {
    cover: { url: "file:///fallback.png" },
    id: "fallback-pack",
    instanceKey: "fallback-pack",
    status: "ok",
    title: "Fallback Pack",
  };
  const list = renderPackCard(iconPack, state(), "list");
  const icons = renderPackCard(iconPack, state(), "icons");
  const fallback = renderPackCard(fallbackPack, state(), "icons");

  assert.match(list, /data-asset-kind="icon"[^>]*data-asset-url="file:\/\/\/icon\.png"/);
  assert.match(icons, /data-asset-kind="icon"[^>]*data-asset-url="file:\/\/\/icon\.png"/);
  assert.match(fallback, /data-asset-kind="cover-fallback"[^>]*data-asset-url="file:\/\/\/fallback\.png"/);
  assert.doesNotMatch(`${list}\n${icons}\n${fallback}`, /hasTransparency|transparent=|artMode|iconFit/);
});

test("loaded library art is classified before reveal without renderer state updates", () => {
  const app = read("app.js");
  const settle = app.slice(app.indexOf("function settleVisualAsset"), app.indexOf("function syncResolvedVisualAssets"));
  const classification = settle.indexOf("resolveLibraryArtPresentation(image)");
  const presentation = settle.indexOf("container.dataset.artPresentation");
  const loadedStatus = settle.indexOf("image.dataset.assetStatus = status");
  const reveal = settle.indexOf("image.hidden = status !== \"loaded\"");

  assert.ok(presentation >= 0 && classification > presentation);
  assert.ok(classification < loadedStatus && loadedStatus < reveal);
  assert.match(settle, /closest\("\.pack-card--list, \.pack-card--icons"\)/);
  assert.match(settle, /status === "loaded"[\s\S]*resolveLibraryArtPresentation\(image\)[\s\S]*"unknown"/);
  assert.doesNotMatch(settle, /store\.setState|renderLibraryPacks|regionRenderer|replaceWith|outerHTML/);
});

test("one shared CSS authority maps transparent, opaque and unknown without view-specific sizing", () => {
  const styles = read(path.join("styles", "app.css"));
  const tokens = read(path.join("styles", "tokens.css"));
  const finalStyles = styles.slice(styles.indexOf(".pack-card--list .pack-card__media,"));

  assert.match(finalStyles, /\.pack-card--list \.pack-card__media\[data-art-presentation="transparent"\] \.pack-card__art,\s*\n\.pack-card--icons \.pack-card__media\[data-art-presentation="transparent"\] \.pack-card__art[\s\S]*object-fit: contain[\s\S]*filter: var\(--icon-art-edge\)[\s\S]*padding: 10%/);
  assert.match(finalStyles, /\.pack-card--list \.pack-card__media\[data-art-presentation="opaque"\] \.pack-card__art,\s*\n\.pack-card--icons \.pack-card__media\[data-art-presentation="opaque"\] \.pack-card__art[\s\S]*object-fit: cover[\s\S]*filter: none[\s\S]*padding: 0/);
  assert.match(finalStyles, /data-art-presentation="unknown"[\s\S]*object-fit: contain[\s\S]*filter: none[\s\S]*padding: 10%/);
  assert.doesNotMatch(styles, /\.pack-card--list \.pack-card__media img\s*\{[^}]*padding/);
  assert.doesNotMatch(styles, /\.pack-card--icons \.pack-card__media img\s*\{[^}]*object-fit/);
  assert.doesNotMatch(`${styles}\n${tokens}`, /icon-art-overscan/);
});

test("classification module remains visual-only, bounded and independent from product state", () => {
  const classifier = read("library-art-presentation.js");
  assert.match(classifier, /LIBRARY_ART_CACHE_LIMIT = 128/);
  assert.match(classifier, /LIBRARY_ART_MAX_ANALYSIS_SIZE = 64/);
  assert.match(classifier, /LIBRARY_ART_ALPHA_THRESHOLD = 224/);
  assert.match(classifier, /LIBRARY_ART_MIN_EXTERIOR_RATIO = 0\.02/);
  assert.match(classifier, /entries\.delete\(entries\.keys\(\)\.next\(\)\.value\)/);
  assert.doesNotMatch(classifier, /store|setState|renderLibraryPacks|ResizeObserver|requestAnimationFrame|ipc|window\.hslLauncher/);
});
