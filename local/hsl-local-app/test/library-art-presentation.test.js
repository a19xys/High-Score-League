const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.join(
  __dirname,
  "..",
  "gui",
  "renderer",
  "library-art-presentation.js",
)).href;

function pixels(width, height, alphaAt = () => 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 40;
      data[offset + 1] = 120;
      data[offset + 2] = 220;
      data[offset + 3] = alphaAt(x, y);
    }
  }
  return { data, height, width };
}

test("exterior alpha distinguishes sprites, corners, internal holes and edge noise", async () => {
  const {
    LIBRARY_ART_ALPHA_THRESHOLD,
    classifyExteriorTransparency,
  } = await import(moduleUrl);
  const size = 16;

  assert.equal(classifyExteriorTransparency(pixels(size, size)), "opaque");
  assert.equal(classifyExteriorTransparency(pixels(size, size, (x, y) => (
    x >= 5 && x <= 10 && y >= 5 && y <= 10 ? 255 : 0
  ))), "transparent");
  assert.equal(classifyExteriorTransparency(pixels(size, size, (x, y) => (
    x >= 6 && x <= 9 && y >= 6 && y <= 9 ? 0 : 255
  ))), "opaque");
  assert.equal(classifyExteriorTransparency(pixels(size, size, (x, y) => (
    x === 0 && y === 0 ? 0 : 255
  ))), "opaque");
  assert.equal(classifyExteriorTransparency(pixels(size, size, (x, y) => (
    (x < 3 || x >= 13) && (y < 3 || y >= 13) ? 0 : 255
  ))), "transparent");
  assert.equal(classifyExteriorTransparency(pixels(size, size, (x, y) => (
    x < 4 && y < 4 ? LIBRARY_ART_ALPHA_THRESHOLD : 255
  ))), "transparent");
});

test("image classification uses JPEG fast path, bounds Canvas to 64px and fails safe", async () => {
  const { classifyImageAlpha } = await import(moduleUrl);
  assert.equal(classifyImageAlpha({ dataset: { assetUrl: "file:///opaque.JPEG" } }), "opaque");
  assert.equal(classifyImageAlpha({
    dataset: { assetUrl: "file:///broken.png" },
    naturalHeight: 8,
    naturalWidth: 8,
  }, {
    canvasFactory: () => { throw new Error("unreadable"); },
  }), "unknown");

  const canvas = {
    getContext() {
      return {
        clearRect() {},
        drawImage() {},
        getImageData: () => pixels(canvas.width, canvas.height),
      };
    },
    height: 0,
    width: 0,
  };
  const result = classifyImageAlpha({
    dataset: { assetUrl: "file:///large.png" },
    naturalHeight: 100,
    naturalWidth: 200,
  }, { canvasFactory: () => canvas });
  assert.equal(result, "opaque");
  assert.deepEqual({ height: canvas.height, width: canvas.width }, { height: 32, width: 64 });
});

test("session cache classifies each URL once and reuses the result", async () => {
  const { createLibraryArtPresentationCache } = await import(moduleUrl);
  const cache = createLibraryArtPresentationCache({ limit: 4 });
  let calls = 0;
  const classify = () => {
    calls += 1;
    return "transparent";
  };

  assert.equal(cache.resolve("file:///sprite.png", classify), "transparent");
  assert.equal(cache.resolve("file:///sprite.png", classify), "transparent");
  assert.equal(calls, 1);
  assert.deepEqual(cache.stats(), {
    classifications: 1,
    evictions: 0,
    hits: 1,
    limit: 4,
    size: 1,
  });
});

test("bounded cache prunes least-recently-used assets and normalizes errors", async () => {
  const { createLibraryArtPresentationCache } = await import(moduleUrl);
  const cache = createLibraryArtPresentationCache({ limit: 2 });
  cache.resolve("a", () => "opaque");
  cache.resolve("b", () => "transparent");
  cache.resolve("a", () => "unknown");
  cache.resolve("c", () => "opaque");
  assert.deepEqual(cache.stats(), {
    classifications: 3,
    evictions: 1,
    hits: 1,
    limit: 2,
    size: 2,
  });
  assert.equal(cache.resolve("b", () => { throw new Error("read failure"); }), "unknown");
  assert.deepEqual(cache.stats(), {
    classifications: 4,
    evictions: 2,
    hits: 1,
    limit: 2,
    size: 2,
  });
});
