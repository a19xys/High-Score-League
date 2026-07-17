const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { submitAll, submitPendingFile } = require("../src/submission-service");

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
    const storedSession = {
      session: { access_token: "secret-token" },
      user: { id: "user-one" },
    };
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
        getValidStoredSessionImpl: async () => storedSession,
        nowMs: Date.parse("2026-07-17T00:00:00Z"),
      });
      assert.equal(result.action, item.expectedAction);
      assert.equal(result.httpStatus, item.status);
      assert.equal(await fileExists(path.join(config.eventsPendingDirAbs, item.filename)), item.expectedBox === "pending");
      assert.equal(await fileExists(path.join(config.eventsSentDirAbs, item.filename)), item.expectedBox === "sent");
      assert.equal(await fileExists(path.join(config.eventsFailedDirAbs, item.filename)), item.expectedBox === "failed");
      assert.equal(JSON.stringify(result).includes("secret-token"), false);
      assert.equal(JSON.stringify(result).includes("temporary"), false);
      if (item.status === 503 || item.status === 429) assert.equal(result.retryable, true);
      if (item.status === 429) assert.equal(result.retryAfterMs, 60000);
    }
  });
});
