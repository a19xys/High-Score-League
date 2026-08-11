const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const enabled = process.env.HSL_RUN_ACCOUNT_PROFILE_BROWSERWINDOW === "1";

test("BrowserWindow remata perfiles, formulario y estado vacío en ambos temas", { skip: !enabled, timeout: 120_000 }, async () => {
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

  for (const initials of ["RAF", "FUK"]) {
    for (const [placement, fallback] of Object.entries(result.activeFallbacks[initials])) {
      assert.equal(fallback.text, initials);
      assert.ok(Math.abs(fallback.x) <= 0.5, `${initials} ${placement} x`);
      assert.ok(Math.abs(fallback.y) <= 0.5, `${initials} ${placement} y`);
    }
  }

  for (const theme of ["dark", "light"]) {
    const existing = result.existing[theme];
    assert.equal(existing.avatars.image.complete, true);
    assert.ok(existing.avatars.image.naturalWidth > 0);
    assert.equal(existing.avatars.fallback, "RAF");
    for (const fallback of existing.avatars.fallbackCenters.filter((item) => ["RAF", "FUK"].includes(item.text))) {
      assert.ok(Math.abs(fallback.x) <= 0.5, `${theme} ${fallback.text} x`);
      assert.ok(Math.abs(fallback.y) <= 0.5, `${theme} ${fallback.text} y`);
    }
    const descenders = existing.avatars.emailMetrics.find((item) => item.text === "player.ygjpq@example.test");
    assert.equal(descenders.whiteSpace, "nowrap");
    assert.equal(descenders.overflow, "hidden");
    assert.ok(Number.parseFloat(descenders.lineHeight) >= 16.8);
    assert.ok(descenders.scrollHeight <= descenders.clientHeight);
    assert.equal(existing.form.background, "rgba(0, 0, 0, 0)");
    assert.equal(existing.form.boxShadow, "none");
    assert.deepEqual([existing.form.borderLeft, existing.form.borderRight, existing.form.borderBottom], ["0px", "0px", "0px"]);
    assert.notEqual(existing.submitIdle.border, existing.submitHover.border);
    assert.notEqual(existing.submitIdle.color, existing.submitHover.color);
    assert.notEqual(existing.submitIdle.background, existing.submitHover.background);

    const empty = result.empty[theme];
    assert.equal(empty.forbiddenNodes, 0);
    assert.match(empty.menuText, /EMAIL/);
    assert.match(empty.menuText, /CONTRASE/);
    assert.match(empty.menuText, /Entrar/);
    assert.match(empty.menuText, /Cancelar/);
    assert.doesNotMatch(empty.menuText, /Sin sesi|Vuelve a iniciar|Cuentas|Sin cuentas recordadas|Añadir cuenta/);
    assert.doesNotMatch(empty.headerText, /Sin sesi/);
    assert.match(empty.headerAria, /Sin sesi/);
    assert.equal(empty.iconWidth, empty.avatarWidth - 2);
    assert.equal(empty.iconHeight, empty.avatarHeight - 2);
    assert.deepEqual(empty.reopened, { email: "", password: "" });
  }

  for (const filename of [
    "accounts-existing-dark.png",
    "accounts-existing-light.png",
    "accounts-empty-dark.png",
    "accounts-empty-light.png",
  ]) {
    assert.equal(fs.existsSync(path.join(screenshotDirectory, filename)), true, filename);
  }
});
