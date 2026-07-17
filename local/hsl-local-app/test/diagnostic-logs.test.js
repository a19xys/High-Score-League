const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  listDiagnosticReports,
  sanitizeDiagnosticReport,
  writeDiagnosticReport,
} = require("../src/diagnostic-logs");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-diagnostic-logs-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("writeDiagnosticReport persists sanitized JSON with runtime context", async () => {
  await withTempDir(async (dir) => {
    const userDataDir = path.join(dir, "AppData", "High Score League");
    const config = {
      clientVersion: "0.1.0-test",
      configSource: "config.json",
      eventsSource: "scoped-user-pack",
      eventQueueRole: "scoped",
      mame: {
        executablePath: path.join(dir, "mame", "mame.exe"),
        pluginName: "hsl-score",
        workingDir: path.join(dir, "mame"),
      },
      pack: {
        gameId: "space-invaders",
        packId: "space-invaders-week-1",
        rom: "invaders",
        weekId: "week-1",
      },
      packLoaded: true,
      packPath: path.join(dir, "pack", "pack.json"),
      packRoot: path.join(dir, "pack"),
      sharedMameRuntime: {
        available: true,
        configured: true,
        mameExecutablePath: path.join(dir, "runtime", "mame.exe"),
        runtimeFile: path.join(userDataDir, "runtime", "mame-runtime.json"),
      },
      userDataDir,
    };
    const report = {
      errors: [{ detail: { Authorization: "Bearer secret-token" }, level: "ERROR", message: "missing [redacted]" }],
      recommendations: ["fix config", "fix config"],
      sections: {
        config: [{ access_token: "secret-access-token", level: "OK", message: "loaded" }],
      },
      warnings: [{ level: "WARN", message: "refresh_token should never appear literally" }],
    };

    const result = await writeDiagnosticReport(config, report, {
      remoteDiagnostics: {
        connectivity: {
          checkedAt: "2026-07-03T21:14:20.000Z",
          displayStatus: "connected",
          healthEndpoint: "https://hsl.example/api/launcher/health",
          probe: { phase: "idle", inFlight: false, startedAt: null },
          reachability: "connected",
          reason: null,
        },
        ranking: {
          active: {
            checkedAt: "2026-07-03T21:14:21.000Z",
            reason: "public-week",
            status: "available",
            url: "https://hsl.example/weeks/week-1",
          },
          cache: { available: 1, entries: 1, expired: 0, unavailable: 0, unknown: 0 },
        },
        securityPolicy: {
          browserSandbox: true,
          delivery: "meta",
          documentProtocol: "file:",
          rendererConnectAllowed: false,
        },
      },
      state: {
        bridge: {
          configSource: "pack abierto",
          mode: "opened-pack",
        },
        library: {
          directory: { exists: true, path: path.join(dir, "library"), status: "ok" },
          packDirectoryPath: path.join(dir, "library"),
          packs: [{ instanceKey: "instance-pack-a" }, { instanceKey: "instance-pack-b" }],
          source: "pack-directory",
          status: "available-populated",
          totals: { packs: 2, packsWithErrors: 1 },
          warnings: ["duplicate pack"],
        },
        queue: {
          failed: { count: 1, exists: true },
          pending: { count: 2, exists: true },
          sent: { count: 3, exists: true },
          totals: { failed: 1, pending: 2, sent: 3 },
        },
        runtime: config.sharedMameRuntime,
        selection: {
          activeInstanceKey: "instance-pack-b",
          rememberedInstanceKey: "instance-pack-b",
          source: "remembered",
        },
        session: {
          access_token: "secret-access-token",
          hasSession: true,
          refresh_token: "secret-refresh-token",
          status: "ok",
          userId: "user-1234567890",
        },
      },
      summary: {
        errorCount: 1,
        warningCount: 1,
      },
    }, {
      now: "2026-07-03T21:14:22.000Z",
    });

    const raw = await fsp.readFile(result.filePath, "utf8");
    const saved = JSON.parse(raw);

    assert.equal(result.diagnosticsDir, path.join(userDataDir, "diagnostics"));
    assert.equal(result.filename, "diagnose-2026-07-03T211422000Z.json");
    assert.equal(saved.format, undefined);
    assert.equal(saved.library.totals.packs, 2);
    assert.equal(saved.library.totals.packsWithErrors, 1);
    assert.equal(saved.library.status, "available-populated");
    assert.equal(saved.library.packCount, 2);
    assert.equal(saved.library.selection.activeInstanceKey, "instance-pack-b");
    assert.equal(saved.library.selection.rememberedInstanceKey, "instance-pack-b");
    assert.equal(saved.library.selection.source, "remembered");
    assert.equal(saved.mame.sharedRuntime.available, true);
    assert.equal(saved.pack.packRoot, config.packRoot);
    assert.equal(saved.queue.totals.failed, 1);
    assert.equal(saved.connectivity.reachability, "connected");
    assert.equal(saved.connectivity.displayStatus, "connected");
    assert.equal(saved.connectivity.probe.inFlight, false);
    assert.equal(saved.rankingCapabilities.active.status, "available");
    assert.equal(saved.rankingCapabilities.cache.entries, 1);
    assert.equal(saved.securityPolicy.delivery, "meta");
    assert.equal(saved.securityPolicy.rendererConnectAllowed, false);
    assert.equal(saved.session.hasSession, true);
    assert.match(saved.session.userId, /^user-1\.\.\./);
    assert.equal(/access_token|refresh_token|Authorization|secret-token|secret-access-token|secret-refresh-token/.test(raw), false);
    assert.deepEqual(await listDiagnosticReports(config), [result.filePath]);
  });
});

test("sanitizeDiagnosticReport removes sensitive keys and scrubs sensitive text", () => {
  const sanitized = sanitizeDiagnosticReport({
    Authorization: "Bearer secret",
    nested: {
      access_token: "secret",
      message: "refresh_token should be hidden",
    },
  });
  const raw = JSON.stringify(sanitized);

  assert.equal(raw.includes("Authorization"), false);
  assert.equal(raw.includes("access_token"), false);
  assert.equal(raw.includes("refresh_token"), false);
  assert.equal(raw.includes("secret"), false);
});
