const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildDiagnoseReport } = require("../src/diagnose");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-diagnose-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function createBaseConfig(root) {
  const pending = path.join(root, "events", "pending");
  const sent = path.join(root, "events", "sent");
  const failed = path.join(root, "events", "failed");
  const mameRoot = path.join(root, "mame");
  const executablePath = path.join(mameRoot, "mame.exe");
  const pluginDir = path.join(mameRoot, "plugins", "hsl-score");
  const sessionFileAbs = path.join(root, ".hsl-session.json");

  await fsp.mkdir(pending, { recursive: true });
  await fsp.mkdir(sent, { recursive: true });
  await fsp.mkdir(failed, { recursive: true });
  await fsp.mkdir(pluginDir, { recursive: true });
  await fsp.writeFile(executablePath, "", "utf8");

  return {
    eventsPendingDir: pending,
    eventsSentDir: sent,
    eventsFailedDir: failed,
    eventsPendingDirAbs: pending,
    eventsSentDirAbs: sent,
    eventsFailedDirAbs: failed,
    webBaseUrl: "http://localhost:3000",
    defaultWeekId: "week-1",
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "anon-key",
    sessionFile: ".hsl-session.json",
    sessionFileAbs,
    clientVersion: "0.1.0",
    mame: {
      executablePath,
      workingDir: mameRoot,
      pluginName: "hsl-score",
    },
  };
}

function hasEntry(entries, level, pattern) {
  return entries.some((entry) => entry.level === level && pattern.test(entry.message));
}

test("diagnose detects hsl-score globally active in plugin.ini", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    await fsp.writeFile(path.join(config.mame.workingDir, "plugin.ini"), "hsl-score               1\n", "utf8");

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "WARN", /activado globalmente/));
    assert.ok(report.recommendations.some((item) => /Desactiva hsl-score globalmente/.test(item)));
  });
});

test("diagnose does not fail when plugin.ini is absent", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "INFO", /No se encontró plugin\.ini/));
    assert.equal(report.errors.length, 0);
  });
});

test("diagnose detects the configured plugin folder", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "OK", /plugin encontrado: hsl-score/));
  });
});

test("diagnose detects missing mame.executablePath target", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    await fsp.unlink(config.mame.executablePath);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.mame, "ERROR", /mame\.executablePath no existe/));
  });
});

test("diagnose confirms practice does not include the score plugin in launcher args", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.launcher, "OK", /practice invaders no incluirá -plugin hsl-score/));
  });
});

test("diagnose warns when webBaseUrl has no protocol", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    config.webBaseUrl = "high-score-league.vercel.app";

    const report = await buildDiagnoseReport(config);

    assert.ok(hasEntry(report.sections.config, "WARN", /webBaseUrl no incluye protocolo/));
  });
});

test("diagnose session summary does not expose tokens", async () => {
  await withTempDir(async (dir) => {
    const config = await createBaseConfig(dir);
    await fsp.writeFile(
      config.sessionFileAbs,
      JSON.stringify({
        schemaVersion: 1,
        user: {
          id: "user-1",
          email: "test@example.com",
        },
        session: {
          access_token: "secret-access-token",
          refresh_token: "secret-refresh-token",
        },
      }),
      "utf8"
    );

    const report = await buildDiagnoseReport(config);
    const serialized = JSON.stringify(report);

    assert.ok(hasEntry(report.sections.session, "OK", /test@example\.com/));
    assert.equal(serialized.includes("secret-access-token"), false);
    assert.equal(serialized.includes("secret-refresh-token"), false);
  });
});
