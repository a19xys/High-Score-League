const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  getAccountSessionRepository,
  saveSession,
} = require("../src/auth");
const { submitPendingFile } = require("../src/submission-service");

async function withTempDir(operation) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-submission-auth-integration-"));
  try {
    return await operation(root);
  } finally {
    await fsp.rm(root, { force: true, recursive: true });
  }
}

async function withServer(handler, operation) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    return await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.once("end", () => resolve(body));
    request.once("error", reject);
  });
}

async function createConfig(root, origin) {
  const userDataDir = path.join(root, "userData");
  const eventsPendingDirAbs = path.join(root, "events", "pending");
  const eventsSentDirAbs = path.join(root, "events", "sent");
  const eventsFailedDirAbs = path.join(root, "events", "failed");
  await Promise.all([
    fsp.mkdir(eventsPendingDirAbs, { recursive: true }),
    fsp.mkdir(eventsSentDirAbs, { recursive: true }),
    fsp.mkdir(eventsFailedDirAbs, { recursive: true }),
  ]);
  return {
    clientVersion: "0.1.0",
    defaultWeekId: "week-1",
    eventsFailedDirAbs,
    eventsPendingDirAbs,
    eventsSentDirAbs,
    recentEventThresholdMs: 0,
    sessionFileAbs: path.join(userDataDir, "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: origin,
    userDataDir,
    webBaseUrl: origin,
  };
}

function event() {
  return {
    detectedAt: "2026-07-18T10:00:00.000Z",
    game: "Space Invaders",
    mameVersion: "MAME 0.265",
    pluginVersion: "0.1.4",
    rom: "invaders",
    schemaVersion: 1,
    score: 1230,
    source: "mame_memory",
  };
}

async function saveExpiredCanonical(config) {
  await saveSession(config, {
    access_token: "old-access-token",
    expires_at: 1,
    refresh_token: "old-refresh-token",
    token_type: "bearer",
  }, {
    email: "player@example.com",
    id: "user-one",
  });
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("expired canonical session refreshes, rotates and submits with exactly the new bearer token", async () => {
  await withTempDir(async (root) => {
    let refreshCalls = 0;
    let ingestCalls = 0;
    let refreshBody = null;
    let ingestAuthorization = null;
    await withServer(async (request, response) => {
      if (request.url === "/auth/v1/token?grant_type=refresh_token") {
        refreshCalls += 1;
        refreshBody = JSON.parse(await readRequestBody(request));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          access_token: "new-access-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "new-refresh-token",
          token_type: "bearer",
          user: { email: "player@example.com", id: "user-one" },
        }));
        return;
      }
      if (request.url === "/api/submissions/ingest") {
        ingestCalls += 1;
        ingestAuthorization = request.headers.authorization || null;
        await readRequestBody(request);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404).end();
    }, async (origin) => {
      const config = await createConfig(root, origin);
      const filename = "refresh-and-submit.json";
      const pendingPath = path.join(config.eventsPendingDirAbs, filename);
      const sentPath = path.join(config.eventsSentDirAbs, filename);
      await fsp.writeFile(pendingPath, JSON.stringify(event()), "utf8");
      await saveExpiredCanonical(config);

      const result = await submitPendingFile(config, filename, { timeoutMs: 1000 });

      assert.equal(result.action, "sent");
      assert.equal(result.outcome, "success");
      assert.equal(refreshCalls, 1);
      assert.deepEqual(refreshBody, { refresh_token: "old-refresh-token" });
      assert.equal(ingestCalls, 1);
      assert.equal(ingestAuthorization, "Bearer new-access-token");
      assert.equal(await exists(pendingPath), false);
      assert.equal(await exists(sentPath), true);

      const canonical = await getAccountSessionRepository(config).read("user-one");
      assert.equal(canonical.sessionRevision, 2);
      assert.equal(canonical.storedSession.session.access_token, "new-access-token");
      assert.equal(canonical.storedSession.session.refresh_token, "new-refresh-token");
    });
  });
});

test("temporary refresh failure with an expired token never reaches ingest and preserves pending as auth-deferred", async () => {
  await withTempDir(async (root) => {
    let refreshCalls = 0;
    let ingestCalls = 0;
    await withServer(async (request, response) => {
      if (request.url === "/auth/v1/token?grant_type=refresh_token") {
        refreshCalls += 1;
        await readRequestBody(request);
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error_code: "provider_temporarily_unavailable" }));
        return;
      }
      if (request.url === "/api/submissions/ingest") {
        ingestCalls += 1;
        await readRequestBody(request);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404).end();
    }, async (origin) => {
      const config = await createConfig(root, origin);
      const filename = "refresh-deferred.json";
      const pendingPath = path.join(config.eventsPendingDirAbs, filename);
      const sentPath = path.join(config.eventsSentDirAbs, filename);
      const failedPath = path.join(config.eventsFailedDirAbs, filename);
      await fsp.writeFile(pendingPath, JSON.stringify(event()), "utf8");
      await saveExpiredCanonical(config);

      const result = await submitPendingFile(config, filename, { timeoutMs: 1000 });

      assert.equal(refreshCalls, 1);
      assert.equal(ingestCalls, 0);
      assert.equal(result.action, "pending");
      assert.equal(result.outcome, "auth-deferred");
      assert.equal(result.authRequired, false);
      assert.equal(result.terminal, false);
      assert.equal(result.preservePending, true);
      assert.equal(await exists(pendingPath), true);
      assert.equal(await exists(sentPath), false);
      assert.equal(await exists(failedPath), false);

      const canonical = await getAccountSessionRepository(config).read("user-one");
      assert.equal(canonical.sessionRevision, 1);
      assert.equal(canonical.storedSession.session.access_token, "old-access-token");
      assert.equal(canonical.storedSession.session.refresh_token, "old-refresh-token");
    });
  });
});
