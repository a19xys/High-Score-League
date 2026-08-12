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
  assert.match(styles, /:is\(\.theme-button--icon, \.icon-button\) > \.button-icon\.ui-icon\s*\{[^}]*width: var\(--circular-control-icon-size\)[^}]*height: var\(--circular-control-icon-size\)/);
  assert.doesNotMatch(styles, /\.ui-icon--close\s*\{[^}]*--icon-glyph-scale/);
  assert.match(styles, /\.game-hero-indicator__icon\.ui-icon\s*\{[^}]*width: 19px[^}]*height: 19px[^}]*flex: 0 0 19px/);
  assert.match(styles, /\.game-hero-indicator--favorite \.game-hero-indicator__icon\.ui-icon\s*\{[^}]*--hero-indicator-icon-size: 20px[^}]*--icon-optical-y: -0\.1px/);
  assert.doesNotMatch(styles, /\.game-hero-indicator--favorite \.game-hero-indicator__icon\.ui-icon\s*\{[^}]*--icon-optical-x/);
  assert.doesNotMatch(styles, /\.favorite-slot[^}]*--icon-optical-|\.favorite-slot[^}]*--icon-glyph-scale/);
});

test("the close control uses the authorized centered square raster asset", async () => {
  const [styles, close] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "styles", "app.css"), "utf8"),
    fsp.readFile(path.join(iconRoot, "close.svg"), "utf8"),
  ]);

  assert.match(close, /width="512px" height="512px" viewBox="0 0 512 512"/);
  assert.match(close, /<image id="image0" width="512" height="512" x="0" y="0"/);
  assert.match(close, /xlink:href="data:image\/png;base64,/);
  assert.doesNotMatch(close, /<path\b|stroke-width=|stroke-linecap=/);
  assert.doesNotMatch(close, /transform=/);
  assert.match(styles, /\.icon-button\s*\{[^}]*--circular-control-icon-size: 18px/);
  assert.match(styles, /\.theme-button--icon\s*\{[^}]*--circular-control-icon-size: 18px/);
  assert.doesNotMatch(styles, /\.ui-icon--close\s*\{[^}]*--icon-glyph-scale/);
  assert.doesNotMatch(styles, /\.ui-icon--close[^}]*\b(?:top|left):/);
});
