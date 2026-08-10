const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_ALPHA_BROWSERWINDOW_TESTS === "1";

const expectedCards = [
  { instanceKey: "instance-0", kind: "icon", presentation: "transparent" },
  { instanceKey: "instance-1", kind: "icon", presentation: "opaque" },
  { instanceKey: "instance-2", kind: "icon", presentation: "opaque" },
  { instanceKey: "instance-3", kind: "icon", presentation: "transparent" },
  { instanceKey: "instance-4", kind: "cover-fallback", presentation: "opaque" },
];

function assertPresentation(cards, label) {
  assert.equal(cards.length, expectedCards.length, label);
  cards.forEach((card, index) => {
    const expected = expectedCards[index];
    assert.equal(card.instanceKey, expected.instanceKey, `${label} ${card.instanceKey}`);
    assert.equal(card.kind, expected.kind, `${label} ${card.instanceKey}`);
    assert.equal(card.presentation, expected.presentation, `${label} ${card.instanceKey}`);
    assert.equal(card.rendered, true, `${label} ${card.instanceKey}`);
    assert.deepEqual(card.natural, { height: 64, width: 64 }, `${label} ${card.instanceKey}`);
    assert.ok(card.imageRect.height > 0 && card.imageRect.width > 0, `${label} ${card.instanceKey}`);
    assert.ok(card.mediaRect.height > 0 && card.mediaRect.width > 0, `${label} ${card.instanceKey}`);
    if (expected.presentation === "transparent") {
      assert.equal(card.objectFit, "contain", `${label} ${card.instanceKey}`);
      assert.notEqual(card.filter, "none", `${label} ${card.instanceKey}`);
      for (const inset of Object.values(card.padding)) {
        assert.ok(inset / card.mediaRect.width >= 0.08 && inset / card.mediaRect.width <= 0.12,
          `${label} ${card.instanceKey}: ${JSON.stringify(card.padding)}`);
      }
    } else {
      assert.equal(card.objectFit, "cover", `${label} ${card.instanceKey}`);
      assert.equal(card.filter, "none", `${label} ${card.instanceKey}`);
      assert.deepEqual(card.padding, { bottom: 0, left: 0, right: 0, top: 0 }, `${label} ${card.instanceKey}`);
    }
  });
}

test("BrowserWindow classifies real file artwork once and preserves alpha-aware library nodes", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const screenshotDirectory = process.env.HSL_LIBRARY_SMOKE_DIR;
  assert.ok(screenshotDirectory, "HSL_LIBRARY_SMOKE_DIR es obligatorio para conservar las capturas del smoke");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "alpha",
      HSL_LIBRARY_TRACE_VISIBLE: "1",
      HSL_LIBRARY_USE_GPU: "1",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());

  assert.match(result.initial.view, /pack-card--covers/);
  assert.equal(result.initial.cache.classifications, 0, "Portadas queda fuera de la clasificación");
  for (const [label, sample] of Object.entries({
    iconsDark: result.iconsDark,
    iconsLight: result.iconsLight,
    listDark: result.listDark,
    listLight: result.listLight,
  })) {
    assertPresentation(sample.cards, label);
    assert.equal(sample.cache.classifications, 5, `${label}: solo cinco URL únicas`);
    assert.equal(sample.cache.size, 5, label);
  }

  assert.ok(result.iconsDark.cache.hits > result.listDark.cache.hits, "Iconos reutiliza la clasificación de Lista");
  assert.ok(result.listLight.cache.hits > result.iconsDark.cache.hits, "Volver a Lista reutiliza el cache");
  assert.deepEqual(result.listDark.cards.map(({ presentation }) => presentation),
    result.iconsDark.cards.map(({ presentation }) => presentation));
  assert.deepEqual(result.iconsDark.cards.map(({ presentation }) => presentation),
    result.iconsLight.cards.map(({ presentation }) => presentation));

  assert.equal(result.selection.scrollerSame, true);
  assert.equal(result.selection.cardsSame, true);
  assert.equal(result.selection.imagesSame, true);
  assert.equal(result.selection.presentationsSame, true);
  assert.equal(result.selection.scrollTop, result.selection.initialScrollTop);
  assert.equal(result.selection.cache.classifications, 5);
  assert.equal(result.passiveInteractions.cache.classifications, 5,
    "resize, hover, scroll y tema no vuelven a analizar");
  assertPresentation(result.passiveInteractions.cards, "passiveInteractions");

  for (const filename of [
    "library-alpha-icons-dark.png",
    "library-alpha-icons-light.png",
    "library-alpha-list-dark.png",
    "library-alpha-list-light.png",
  ]) {
    assert.equal(fs.existsSync(path.join(screenshotDirectory, filename)), true, filename);
  }
});
