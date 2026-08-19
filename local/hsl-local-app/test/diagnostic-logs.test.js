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
        sessions: {
          repository: {
            requiresLoginTransitions: [{
              nextStatus: "revoked",
              providerCode: "refresh_token_revoked",
              refresh_token: "must-not-persist",
              userHash: "user_safehash",
            }],
          },
        },
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
        playTime: {
          activeSessions: 0,
          sync: {
            Authorization: "Bearer secret-playtime-token",
            acknowledged: 4,
            email: "player@example.test",
            followUpQueued: false,
            inFlight: false,
            lastRemoteGameKey: "space-invaders",
            lastRemoteGameTotalSeconds: 3180,
            lastRemoteTotalSeconds: 9000,
            lastSuccessfulAckAt: "2026-07-03T21:14:21.500Z",
            refresh_token: "must-not-persist",
          },
        },
        weekCapabilities: {
          context: {
            deploymentKey: "build-a:production:1",
            generation: 4,
            webBaseUrl: "https://hsl.example",
          },
          lastAttemptResult: "failed",
          lastFailureReason: "deployment-mismatch",
          lastRequest: {
            Authorization: "Bearer secret-week-token",
            deploymentMatch: false,
            expectedDeployment: { apiVersion: 1, build: "build-a", environment: "production" },
            receivedBodyDeployment: { apiVersion: 1, build: "build-b", environment: "production" },
            receivedHeaderDeployment: { apiVersion: 1, build: "build-b", environment: "production" },
            responseBody: { access_token: "must-not-persist" },
          },
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
    assert.equal(saved.accountSessions.repository.requiresLoginTransitions[0].providerCode, "refresh_token_revoked");
    assert.equal(saved.accountSessions.repository.requiresLoginTransitions[0].userHash, "user_safehash");
    assert.equal(saved.accountSessions.repository.requiresLoginTransitions[0].refresh_token, undefined);
    assert.equal(saved.library.selection.source, "remembered");
    assert.equal(saved.mame.sharedRuntime.available, true);
    assert.equal(saved.pack.packRoot, config.packRoot);
    assert.equal(saved.queue.totals.failed, 1);
    assert.equal(saved.connectivity.reachability, "connected");
    assert.equal(saved.connectivity.displayStatus, "connected");
    assert.equal(saved.connectivity.probe.inFlight, false);
    assert.equal(saved.rankingCapabilities.active.status, "available");
    assert.equal(saved.rankingCapabilities.cache.entries, 1);
    assert.equal(saved.playTime.activeSessions, 0);
    assert.equal(saved.playTime.sync.acknowledged, 4);
    assert.equal(saved.playTime.sync.lastRemoteGameKey, "space-invaders");
    assert.equal(saved.playTime.sync.lastRemoteGameTotalSeconds, 3180);
    assert.equal(saved.playTime.sync.lastRemoteTotalSeconds, 9000);
    assert.equal(saved.playTime.sync.Authorization, undefined);
    assert.equal(saved.playTime.sync.email, undefined);
    assert.equal(saved.playTime.sync.refresh_token, undefined);
    assert.equal(saved.weekCapabilities.context.deploymentKey, "build-a:production:1");
    assert.equal(saved.weekCapabilities.context.generation, 4);
    assert.equal(saved.weekCapabilities.lastAttemptResult, "failed");
    assert.equal(saved.weekCapabilities.lastFailureReason, "deployment-mismatch");
    assert.equal(saved.weekCapabilities.lastRequest.deploymentMatch, false);
    assert.deepEqual(saved.weekCapabilities.lastRequest.expectedDeployment, { apiVersion: 1, build: "build-a", environment: "production" });
    assert.deepEqual(saved.weekCapabilities.lastRequest.receivedHeaderDeployment, { apiVersion: 1, build: "build-b", environment: "production" });
    assert.deepEqual(saved.weekCapabilities.lastRequest.receivedBodyDeployment, { apiVersion: 1, build: "build-b", environment: "production" });
    assert.equal(saved.weekCapabilities.lastRequest.Authorization, undefined);
    assert.equal(saved.weekCapabilities.lastRequest.responseBody.access_token, undefined);
    assert.equal(saved.securityPolicy.delivery, "meta");
    assert.equal(saved.securityPolicy.rendererConnectAllowed, false);
    assert.equal(saved.session.hasSession, true);
    assert.match(saved.session.userId, /^user-1\.\.\./);
    assert.equal(/"(?:access_token|refresh_token|Authorization|email)"\s*:|secret-token|secret-access-token|secret-refresh-token|secret-week-token|secret-playtime-token|player@example\.test|must-not-persist/.test(raw), false);
    assert.deepEqual(await listDiagnosticReports(config), [result.filePath]);
  });
});

test("sanitizeDiagnosticReport removes sensitive keys and scrubs sensitive text", () => {
  const sanitized = sanitizeDiagnosticReport({
    Authorization: "Bearer secret",
    email: "player@example.test",
    nested: {
      access_token: "secret",
      message: "refresh_token should be hidden",
    },
  });
  const raw = JSON.stringify(sanitized);

  assert.equal(raw.includes("Authorization"), false);
  assert.equal(raw.includes("access_token"), false);
  assert.equal(raw.includes("refresh_token"), false);
  assert.equal(raw.includes("player@example.test"), false);
  assert.equal(raw.includes("secret"), false);
});
