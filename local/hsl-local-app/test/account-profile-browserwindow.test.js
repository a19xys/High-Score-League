const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_ACCOUNT_PROFILE_BROWSERWINDOW === "1";

function interactionColors(style) {
  return { background: style.background, border: style.border, color: style.color };
}

function rgbLuminance(value) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
  assert.equal(channels.length, 3, value);
  return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
}

test("BrowserWindow remata cuentas, sesion transitoria y detalle sin status legacy", { skip: !enabled, timeout: 120_000 }, async () => {
  const screenshotDirectory = process.env.HSL_LIBRARY_SMOKE_DIR;
  assert.ok(screenshotDirectory);
  const electron = require("electron");
  const fixture = path.join(__dirname, "..", "test-support", "library-browserwindow-fixture-main.cjs");
  const { stdout } = await execFileAsync(electron, [fixture], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
      HSL_LIBRARY_CHECK_ONLY: "profiles",
    },
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const result = JSON.parse(stdout.trim());

  for (const initials of ["RAF", "FUK", "AA", "HSL"]) {
    for (const [placement, fallback] of Object.entries(result.activeFallbacks[initials])) {
      assert.equal(fallback.text, initials);
      assert.ok(Math.abs(fallback.x) <= 0.5, `${initials} ${placement} x`);
      assert.ok(Math.abs(fallback.y) <= 0.5, `${initials} ${placement} y`);
      assert.ok(fallback.topInset > 0, `${initials} ${placement} top inset`);
      assert.ok(fallback.bottomInset > 0, `${initials} ${placement} bottom inset`);
      assert.ok(Math.abs(fallback.topInset - fallback.bottomInset) <= 1, `${initials} ${placement} balanced insets`);
      assert.ok(Number.parseFloat(fallback.lineHeight) >= 13, `${initials} ${placement} natural line-height`);
    }
  }

  const fallbackBackgrounds = {};
  for (const theme of ["dark", "light"]) {
    const existing = result.existing[theme];
    assert.equal(existing.avatars.image.complete, true);
    assert.ok(existing.avatars.image.naturalWidth > 0);
    assert.equal(existing.avatars.fallback, "RAF");
    const measuredFallbacks = existing.avatars.fallbackCenters.filter((item) => ["RAF", "FUK", "AA", "HSL"].includes(item.text));
    assert.deepEqual(new Set(measuredFallbacks.map((item) => item.text)), new Set(["RAF", "FUK", "AA", "HSL"]));
    for (const fallback of measuredFallbacks) {
      assert.ok(Math.abs(fallback.x) <= 0.5, `${theme} ${fallback.text} x`);
      assert.ok(Math.abs(fallback.y) <= 0.5, `${theme} ${fallback.text} y`);
      assert.ok(fallback.topInset > 0 && fallback.bottomInset > 0, `${theme} ${fallback.text} unclipped`);
    }
    fallbackBackgrounds[theme] = measuredFallbacks[0].background;
    assert.ok(measuredFallbacks.every((item) => item.background === fallbackBackgrounds[theme]));

    const descenders = existing.avatars.emailMetrics.find((item) => item.text === "player.ygjpq@example.test");
    assert.equal(descenders.whiteSpace, "nowrap");
    assert.equal(descenders.overflow, "hidden");
    assert.ok(Number.parseFloat(descenders.lineHeight) >= 16.8);
    assert.ok(descenders.scrollHeight <= descenders.clientHeight);
    assert.equal(existing.form.background, "rgba(0, 0, 0, 0)");
    assert.equal(existing.form.boxShadow, "none");
    assert.deepEqual([existing.form.borderLeft, existing.form.borderRight, existing.form.borderBottom], ["0px", "0px", "0px"]);

    assert.deepEqual(interactionColors(existing.submitIdle), interactionColors(existing.cancelIdle), `${theme} idle login buttons`);
    assert.deepEqual(interactionColors(existing.submitHover), interactionColors(existing.cancelHover), `${theme} hover login buttons`);
    assert.notDeepEqual(interactionColors(existing.addAccountIdle), interactionColors(existing.addAccountHover), `${theme} primary hover`);

    assert.notEqual(existing.chevronClosed.transform, existing.chevronOpen.transform);
    assert.match(existing.chevronClosed.transform, /^matrix\(/);
    assert.match(existing.chevronOpen.transform, /^matrix\(/);

    const empty = result.empty[theme];
    assert.equal(empty.forbiddenNodes, 0);
    assert.match(empty.menuText, /EMAIL/);
    assert.match(empty.menuText, /CONTRASE/);
    assert.match(empty.menuText, /Entrar/);
    assert.match(empty.menuText, /Cancelar/);
    assert.doesNotMatch(empty.menuText, /Cuentas/);
    assert.equal(empty.iconWidth, 24);
    assert.equal(empty.iconHeight, 24);
    assert.deepEqual(empty.reopened, { email: "", password: "" });

    const remembered = result.remembered[theme];
    assert.equal(remembered.toggleActions, 1);
    assert.deepEqual([remembered.header.iconWidth, remembered.header.iconHeight], [24, 24]);
    assert.deepEqual([remembered.menu.iconWidth, remembered.menu.iconHeight], [24, 24]);
    assert.equal(remembered.header.background, remembered.menu.background);
    assert.notEqual(remembered.closedTransform, remembered.openTransform);
  }

  assert.notEqual(fallbackBackgrounds.dark, fallbackBackgrounds.light);
  assert.ok(rgbLuminance(fallbackBackgrounds.dark) < rgbLuminance(fallbackBackgrounds.light));

  assert.equal(result.replacement.forgotA, true);
  assert.equal(result.replacement.replacementActive, true);
  assert.match(result.replacement.activeTitle, /valid@example\.test/);
  assert.equal(result.replacement.emptyUserVisible, false);
  assert.equal(result.replacement.sessionActionRequired, false);
  assert.equal(result.transientSession.deferred.accountRequiresLogin, false);
  assert.equal(result.transientSession.deferred.actionRequired, false);
  assert.match(result.transientSession.recoveredTitle, /valid@example\.test/);

  for (const [status, detail] of Object.entries(result.detail)) {
    assert.equal(detail.legacyRegions, 0, status);
    assert.equal(detail.firstRegion, "game-identity", status);
    assert.ok(detail.title.length > 0, status);
    assert.equal(detail.heroChecking, status === "checking", status);
  }

  for (const filename of [
    "accounts-existing-dark.png",
    "accounts-existing-light.png",
    "accounts-closed-dark.png",
    "accounts-closed-light.png",
    "accounts-empty-dark.png",
    "accounts-empty-light.png",
    "detail-no-legacy-status.png",
  ]) {
    assert.equal(fs.existsSync(path.join(screenshotDirectory, filename)), true, filename);
  }
});
