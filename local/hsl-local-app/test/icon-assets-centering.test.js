const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");
const iconRoot = path.join(rendererRoot, "assets", "icons");

test("hero icons are normalized assets rather than embedded raster canvases or CSS offsets", async () => {
  const names = ["star-filled", "star-empty", "check"];
  const [styles, ...icons] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    ...names.map((name) => fsp.readFile(path.join(iconRoot, `${name}.svg`), "utf8")),
  ]);

  for (const [index, svg] of icons.entries()) {
    assert.match(svg, /viewBox="0 0 24 24"/, names[index]);
    assert.match(svg, /<(?:path|circle|polyline)\b/, names[index]);
    assert.doesNotMatch(svg, /data:image|<image\b|base64/, names[index]);
  }

  assert.doesNotMatch(
    styles,
    /\.ui-icon--(?:star-filled|star-empty|check|error|close|refresh)[^{]*\{[^}]*(?:translate|\btop:|\bleft:)/,
  );
});

