const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_BROWSERWINDOW_TESTS === "1";

test("BrowserWindow preserves library scroll through activation and keeps the final visual contracts", { skip: !enabled, timeout: 30_000 }, async () => {
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());

  for (const selection of result.selections) {
    const [before, pending, accepted, refresh, oneFrame, twoFrames] = selection.trace;
    assert.equal(pending.identity, before.identity);
    assert.equal(refresh.identity, before.identity);
    assert.ok(Math.abs(pending.scrollTop - before.scrollTop) <= 1);
    if (accepted.scrollHeight - accepted.clientHeight >= before.scrollTop) {
      assert.ok(Math.abs(accepted.scrollTop - before.scrollTop) <= 1);
    }
    for (const sample of [refresh, oneFrame, twoFrames]) {
      assert.ok(Math.abs(sample.scrollTop - before.scrollTop) <= 1);
      assert.equal(sample.detailScrollTop, 0);
    }
  }
  assert.equal(result.samePackDetail, 120);
  for (const theme of [result.visuals.dark, result.visuals.light]) {
    assert.deepEqual(theme.active, {
      ariaCurrent: "true",
      ariaDisabled: null,
      role: null,
      selectable: false,
      favoriteDisabled: false,
    });
    assert.deepEqual(theme.favorite.active, theme.favorite.other);
    assert.deepEqual(theme.selectedBadge.active, theme.selectedBadge.other);
    assert.equal(theme.badges.LISTO.color, theme.semanticColors.success);
    assert.equal(theme.badges.LEGACY.color, theme.semanticColors.warning);
    assert.equal(theme.badges.AVISO.color, theme.semanticColors.warning);
    assert.equal(theme.badges["REQUIERE ATENCION"].color, theme.semanticColors.error);
    assert.notEqual(theme.badges.LISTO.background, theme.badges.LEGACY.background);
    assert.notEqual(theme.badges.LEGACY.background, theme.badges["REQUIERE ATENCION"].background);
  }
  assert.deepEqual(result.rows.map(({ columns }) => columns), [2, 3, 4]);
  result.rows.forEach(({ heights }) => heights.forEach((height) => assert.ok(Math.abs(height - heights[0]) <= 1)));
  assert.deepEqual(result.dots.connection, result.dots.pack);
  assert.deepEqual(result.dots.pack, {
    after: "none",
    border: "0px",
    height: "8px",
    radius: "999px",
    shadow: result.dots.connection.shadow,
    width: "8px",
  });
  assert.ok(result.minimum.bottomGap >= 39 && result.minimum.bottomGap <= 41);
  assert.equal(result.minimum.outerBounds.width, 1200);
  assert.equal(result.minimum.outerBounds.height, 620);
  assert.ok(result.minimum.detailWidth >= 540);
  assert.equal(result.minimum.documentOverflowX, 0);
  assert.equal(result.minimum.documentOverflowY, 0);
  assert.ok(result.minimum.gameScrollTop > 0);
});
