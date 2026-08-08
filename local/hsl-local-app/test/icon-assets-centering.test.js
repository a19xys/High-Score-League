const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");
const iconRoot = path.join(rendererRoot, "assets", "icons");

test("hero icons use square source boxes and structural glyph centering", async () => {
  const names = ["star-filled", "star-empty", "check"];
  const [styles, ...icons] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    ...names.map((name) => fsp.readFile(path.join(iconRoot, `${name}.svg`), "utf8")),
  ]);

  for (const [index, svg] of icons.entries()) {
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(viewBox, names[index]);
    assert.equal(viewBox[1], viewBox[2], names[index]);
    assert.match(svg, /<(?:path|circle|polyline|image)\b/, names[index]);
  }

  assert.doesNotMatch(
    styles,
    /\.ui-icon--(?:star-filled|star-empty|check|error|close|refresh)[^{]*\{[^}]*(?:translate|\btop:|\bleft:)/,
  );
  assert.match(styles, /\.ui-icon__glyph\s*\{[^}]*mask-position: center[^}]*mask-size: contain[^}]*transform: translate\(var\(--icon-optical-x, 0\), var\(--icon-optical-y, 0\)\) scale\(var\(--icon-glyph-scale, 1\)\)/);
  assert.match(styles, /\.icon-button \.ui-icon--close\s*\{[^}]*--icon-glyph-scale: 0\.82/);
  assert.match(styles, /\.game-hero-indicator--favorite \.game-hero-indicator__icon\.ui-icon\s*\{[^}]*--icon-optical-x: -0\.5px[^}]*--icon-optical-y: -0\.5px/);
  assert.doesNotMatch(styles, /\.favorite-slot[^}]*--icon-optical-|\.favorite-slot[^}]*--icon-glyph-scale/);
});

test("the close control uses a compact centered vector glyph", async () => {
  const [styles, close] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(iconRoot, "close.svg"), "utf8"),
  ]);

  assert.match(close, /viewBox="0 0 24 24"/);
  assert.match(close, /M7 7 17 17M17 7 7 17/);
  assert.doesNotMatch(close, /<image\b|data:image|base64/);
  assert.match(styles, /\.icon-button \.ui-icon--close\s*\{[^}]*--icon-glyph-scale: 0\.82/);
  assert.doesNotMatch(styles, /\.ui-icon--close[^}]*\b(?:top|left):/);
});
