const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { submitAll, submitPendingFile } = require("../src/submission-service");
const { createSessionResult } = require("../src/session-result");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-submit-service-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createQueueConfig(root, overrides = {}) {
  const pending = path.join(root, "events", "pending");
  const sent = path.join(root, "events", "sent");
  const failed = path.join(root, "events", "failed");

  await fsp.mkdir(pending, { recursive: true });
  await fsp.mkdir(sent, { recursive: true });
  await fsp.mkdir(failed, { recursive: true });

  return {
    clientVersion: "0.1.0",
    defaultWeekId: "week-1",
    eventsPendingDirAbs: pending,
    eventsSentDirAbs: sent,
    eventsFailedDirAbs: failed,
    recentEventThresholdMs: 60000,
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://example.supabase.co",
    webBaseUrl: "https://high-score-league.example",
    ...overrides,
  };
}

function validEvent() {
  return {
    schemaVersion: 1,
    game: "Space Invaders",
    rom: "invaders",
    score: 1230,
    detectedAt: "2026-05-24T22:08:00Z",
    source: "mame_memory",
    mameVersion: "MAME 0.265",
    pluginVersion: "0.1.4",
  };
}

function storedSession(suffix = "one") {
  return {
    supabaseUrl: "https://example.supabase.co",
    session: {
      access_token: `secret-token-${suffix}`,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `secret-refresh-${suffix}`,
    },
    user: { id: "user-one" },
  };
}

async function captureConsoleAsync(fn) {
  const lines = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (line = "") => lines.push(String(line));
  process.exitCode = undefined;

  try {
    await fn();
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }

  return lines.join("\n");
}

test("submit-all skips very recent pending events without moving them", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir);
    const filename = "recent.json";
    const pendingPath = path.join(config.eventsPendingDirAbs, filename);

    await fsp.writeFile(pendingPath, JSON.stringify(validEvent()), "utf8");

    const output = await captureConsoleAsync(() => submitAll(config));

    assert.match(output, /\[SKIP\] recent\.json/);
    assert.match(output, /evitar leer un JSON mientras MAME lo escribe/);
    assert.equal(await fileExists(pendingPath), true);
    assert.equal(await fileExists(path.join(config.eventsSentDirAbs, filename)), false);
    assert.equal(await fileExists(path.join(config.eventsFailedDirAbs, filename)), false);
  });
});

test("submit keeps a recent invalid JSON in pending", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir);
    const filename = "partial.json";
    const pendingPath = path.join(config.eventsPendingDirAbs, filename);

    await fsp.writeFile(pendingPath, "{", "utf8");

    const result = await submitPendingFile(config, filename);

    assert.equal(result.action, "pending");
    assert.match(result.message, /demasiado reciente/);
    assert.equal(await fileExists(pendingPath), true);
    assert.equal(await fileExists(path.join(config.eventsSentDirAbs, filename)), false);
    assert.equal(await fileExists(path.join(config.eventsFailedDirAbs, filename)), false);
  });
});

test("submit moves an old invalid JSON to failed", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir, { recentEventThresholdMs: 2000 });
    const filename = "invalid.json";
    const pendingPath = path.join(config.eventsPendingDirAbs, filename);
    const old = new Date(Date.now() - 10000);

    await fsp.writeFile(pendingPath, "{", "utf8");
    await fsp.utimes(pendingPath, old, old);

    const result = await submitPendingFile(config, filename);

    assert.equal(result.action, "failed");
    assert.equal(await fileExists(pendingPath), false);
    assert.equal(await fileExists(path.join(config.eventsSentDirAbs, filename)), false);
    assert.equal(await fileExists(path.join(config.eventsFailedDirAbs, filename)), true);
  });
});

test("HTTP outcomes move only success and terminal failures while retryable and unexpected responses stay pending", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir, { recentEventThresholdMs: 0 });
    const sessionResult = createSessionResult({ status: "valid", storedSession: storedSession() });
    const cases = [
      { expectedAction: "sent", expectedBox: "sent", filename: "success.json", status: 200, body: { ok: true } },
      { expectedAction: "pending", expectedBox: "pending", filename: "retry.json", status: 503, body: { error: "temporary" } },
      { expectedAction: "pending", expectedBox: "pending", filename: "rate.json", status: 429, body: { error: "slow" }, retryAfter: "60" },
      { expectedAction: "pending", expectedBox: "pending", filename: "unexpected.json", status: 422, body: { error: "unexpected" } },
      { expectedAction: "auth_required", expectedBox: "pending", filename: "auth.json", status: 401, body: { error: "auth" } },
      { expectedAction: "failed", expectedBox: "failed", filename: "terminal.json", status: 400, body: { error: "invalid" } },
    ];

    for (const item of cases) {
      await fsp.writeFile(path.join(config.eventsPendingDirAbs, item.filename), JSON.stringify(validEvent()), "utf8");
      const result = await submitPendingFile(config, item.filename, {
        fetchImpl: async () => new Response(JSON.stringify(item.body), {
          status: item.status,
          headers: item.retryAfter ? { "retry-after": item.retryAfter } : undefined,
        }),
        sessionResult,
        nowMs: Date.parse("2026-07-17T00:00:00Z"),
      });
      assert.equal(result.action, item.expectedAction);
      assert.equal(result.httpStatus, item.status);
      assert.equal(await fileExists(path.join(config.eventsPendingDirAbs, item.filename)), item.expectedBox === "pending");
      assert.equal(await fileExists(path.join(config.eventsSentDirAbs, item.filename)), item.expectedBox === "sent");
      assert.equal(await fileExists(path.join(config.eventsFailedDirAbs, item.filename)), item.expectedBox === "failed");
      assert.equal(JSON.stringify(result).includes("secret-token-one"), false);
      assert.equal(JSON.stringify(result).includes("temporary"), false);
      if (item.status === 503 || item.status === 429) assert.equal(result.retryable, true);
      if (item.status === 429) assert.equal(result.retryAfterMs, 60000);
    }
  });
});

test("deferred, cancelled, stale and lock-timeout session results never post or move pending", async () => {
  for (const status of ["deferred", "cancelled", "stale", "lock-timeout"]) {
    await withTempDir(async (dir) => {
      const config = await createQueueConfig(dir, { recentEventThresholdMs: 0 });
      const filename = `${status}.json`;
      const pendingPath = path.join(config.eventsPendingDirAbs, filename);
      await fsp.writeFile(pendingPath, JSON.stringify(validEvent()), "utf8");
      let posts = 0;
      const result = await submitPendingFile(config, filename, {
        fetchImpl: async () => {
          posts += 1;
          throw new Error("post must not run");
        },
        sessionResult: createSessionResult({
          status,
          storedSession: storedSession(status),
          sessionRevision: 7,
        }),
      });

      assert.equal(posts, 0, status);
      assert.equal(result.action, "pending", status);
      assert.equal(result.outcome, "auth-deferred", status);
      assert.equal(result.authRequired, false, status);
      assert.equal(result.terminal, false, status);
      assert.equal(result.preservePending, true, status);
      assert.equal(result.retryable, true, status);
      assert.equal(result.sessionStatus, status, status);
      assert.equal(await fileExists(pendingPath), true, status);
      assert.equal(await fileExists(path.join(config.eventsSentDirAbs, filename)), false, status);
      assert.equal(await fileExists(path.join(config.eventsFailedDirAbs, filename)), false, status);
    });
  }
});

test("requiresLogin remains auth-required without posting or consuming pending", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir, { recentEventThresholdMs: 0 });
    const filename = "revoked.json";
    const pendingPath = path.join(config.eventsPendingDirAbs, filename);
    await fsp.writeFile(pendingPath, JSON.stringify(validEvent()), "utf8");
    let posts = 0;
    const result = await submitPendingFile(config, filename, {
      fetchImpl: async () => {
        posts += 1;
        throw new Error("post must not run");
      },
      sessionResult: createSessionResult({ status: "revoked", sessionRevision: 8 }),
    });

    assert.equal(posts, 0);
    assert.equal(result.action, "auth_required");
    assert.equal(result.outcome, "auth-required");
    assert.equal(result.authRequired, true);
    assert.equal(result.terminal, false);
    assert.equal(result.preservePending, true);
    assert.equal(await fileExists(pendingPath), true);
  });
});

test("an old remote-usable result is revalidated before posting and does not consume pending", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir, { recentEventThresholdMs: 0 });
    const filename = "expired-after-resolution.json";
    const pendingPath = path.join(config.eventsPendingDirAbs, filename);
    await fsp.writeFile(pendingPath, JSON.stringify(validEvent()), "utf8");
    const expiredAfterResolution = storedSession("expired-after-resolution");
    expiredAfterResolution.session.expires_at = 100;
    let posts = 0;
    const result = await submitPendingFile(config, filename, {
      fetchImpl: async () => {
        posts += 1;
        throw new Error("post must not run");
      },
      nowMs: 200_000,
      sessionResult: createSessionResult({
        sessionRevision: 9,
        status: "valid",
        storedSession: expiredAfterResolution,
      }),
    });

    assert.equal(posts, 0);
    assert.equal(result.outcome, "auth-deferred");
    assert.equal(result.sessionDeferred, true);
    assert.equal(result.terminal, false);
    assert.equal(await fileExists(pendingPath), true);
  });
});

test("remoteUsable is the posting gate for refreshed and residual deferred credentials", async () => {
  for (const status of ["refreshed", "deferred"]) {
    await withTempDir(async (dir) => {
      const config = await createQueueConfig(dir, { recentEventThresholdMs: 0 });
      const filename = `${status}-usable.json`;
      await fsp.writeFile(path.join(config.eventsPendingDirAbs, filename), JSON.stringify(validEvent()), "utf8");
      let resolverCalls = 0;
      let posts = 0;
      const canonicalResult = createSessionResult({
        remoteUsable: true,
        status,
        storedSession: storedSession(status),
        sessionRevision: 9,
      });
      const result = await submitPendingFile(config, filename, {
        fetchImpl: async () => {
          posts += 1;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
        getSessionResultImpl: async () => {
          resolverCalls += 1;
          return canonicalResult;
        },
      });

      assert.equal(resolverCalls, 1, status);
      assert.equal(posts, 1, status);
      assert.equal(result.action, "sent", status);
      assert.equal(await fileExists(path.join(config.eventsSentDirAbs, filename)), true, status);
    });
  }
});

test("session resolution errors are deferred instead of forcing login", async () => {
  await withTempDir(async (dir) => {
    const config = await createQueueConfig(dir, { recentEventThresholdMs: 0 });
    const filename = "resolution-error.json";
    const pendingPath = path.join(config.eventsPendingDirAbs, filename);
    await fsp.writeFile(pendingPath, JSON.stringify(validEvent()), "utf8");
    const result = await submitPendingFile(config, filename, {
      getSessionResultImpl: async () => {
        throw new Error("temporary storage failure");
      },
    });
    assert.equal(result.outcome, "auth-deferred");
    assert.equal(result.authRequired, false);
    assert.equal(result.terminal, false);
    assert.equal(await fileExists(pendingPath), true);
  });
});
