const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { saveSession } = require("../src/auth");
const { checkSeasonMembership } = require("../src/season-membership");

async function withTempDir(operation) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-membership-auth-integration-"));
  try {
    return await operation(root);
  } finally {
    await fsp.rm(root, { force: true, recursive: true });
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function withLocalServer(handleRequest, operation) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handleRequest(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "fixture_failure" }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    return await operation(origin);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function integrationConfig(root, origin) {
  return {
    defaultWeekId: "week-1",
    sessionFileAbs: path.join(root, "userData", "session.json"),
    supabaseAnonKey: "local-anon-key",
    supabaseUrl: origin,
    userDataDir: path.join(root, "userData"),
    webBaseUrl: origin,
  };
}

function expiredSession() {
  return {
    access_token: "expired-access-token",
    expires_at: Math.floor(Date.now() / 1000) - 60,
    expires_in: 0,
    refresh_token: "initial-refresh-token",
    token_type: "bearer",
  };
}

function sessionState(userId) {
  return { hasSession: true, userId };
}

test("membership uses the rotated access token from the first real canonical refresh", async () => {
  await withTempDir(async (root) => {
    const observed = {
      membershipAuthorization: [],
      membershipCalls: 0,
      refreshBodies: [],
      refreshCalls: 0,
    };
    await withLocalServer(async (request, response) => {
      const url = new URL(request.url, "http://fixture.invalid");
      if (url.pathname === "/auth/v1/token") {
        observed.refreshCalls += 1;
        observed.refreshBodies.push(JSON.parse(await readRequestBody(request)));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          access_token: "rotated-access-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          refresh_token: "rotated-refresh-token",
          token_type: "bearer",
          user: { email: "player@example.com", id: "user-refresh-integration" },
        }));
        return;
      }
      if (url.pathname === "/api/local/season-membership") {
        observed.membershipCalls += 1;
        observed.membershipAuthorization.push(request.headers.authorization || null);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          ok: true,
          seasonId: "season-1",
          status: "member",
          weekId: url.searchParams.get("weekId"),
        }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    }, async (origin) => {
      const config = integrationConfig(root, origin);
      const user = { email: "player@example.com", id: "user-refresh-integration" };
      await saveSession(config, expiredSession(), user);

      const result = await checkSeasonMembership(config, sessionState(user.id), {
        sessionTimeoutMs: 2000,
        timeoutMs: 2000,
      });

      assert.equal(result.status, "member");
      assert.equal(result.canSubmit, true);
      assert.equal(observed.refreshCalls, 1);
      assert.deepEqual(observed.refreshBodies, [{ refresh_token: "initial-refresh-token" }]);
      assert.equal(observed.membershipCalls, 1);
      assert.deepEqual(observed.membershipAuthorization, ["Bearer rotated-access-token"]);
    });
  });
});

test("temporary refresh 503 preserves the expired session without calling membership", async () => {
  await withTempDir(async (root) => {
    const observed = { membershipCalls: 0, refreshCalls: 0 };
    await withLocalServer(async (request, response) => {
      const url = new URL(request.url, "http://fixture.invalid");
      if (url.pathname === "/auth/v1/token") {
        observed.refreshCalls += 1;
        await readRequestBody(request);
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "provider_temporarily_unavailable" }));
        return;
      }
      if (url.pathname === "/api/local/season-membership") {
        observed.membershipCalls += 1;
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "must_not_be_called" }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    }, async (origin) => {
      const config = integrationConfig(root, origin);
      const user = { email: "player@example.com", id: "user-deferred-integration" };
      await saveSession(config, expiredSession(), user);

      const result = await checkSeasonMembership(config, sessionState(user.id), {
        sessionTimeoutMs: 2000,
        timeoutMs: 2000,
      });

      assert.equal(observed.refreshCalls, 1);
      assert.equal(observed.membershipCalls, 0);
      assert.equal(result.status, "unknown");
      assert.equal(result.authDeferred, true);
      assert.equal(result.sessionStatus, "deferred");
      assert.equal(result.canPlayCompetition, true);
      assert.equal(result.canSubmit, false);
      assert.match(result.technicalReason, /^auth-deferred:/);
      assert.doesNotMatch(JSON.stringify(result), /expired-access-token|initial-refresh-token|Authorization/);
    });
  });
});
