const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  classifySessionRefreshError,
  getAuthState,
  refreshProviderSession,
  requestProviderRefresh,
  saveSession,
} = require("../src/auth");

async function withServer(handler, operation) {
  const server = http.createServer(handler);
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

function stored(origin, expiresAt = Math.floor(Date.now() / 1000) + 5) {
  return {
    session: {
      access_token: "old-access-secret",
      expires_at: expiresAt,
      refresh_token: "old-refresh-secret",
    },
    supabaseUrl: origin,
    user: { email: "player@example.com", id: "user-1" },
  };
}

test("local refresh fixture rotates both tokens once and preserves identity", async () => {
  let calls = 0;
  let requestBody = null;
  await withServer((request, response) => {
    calls += 1;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      requestBody = JSON.parse(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "new-access-secret",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "new-refresh-secret",
        token_type: "bearer",
        user: { email: "player@example.com", id: "user-1" },
      }));
    });
  }, async (origin) => {
    const refreshed = await refreshProviderSession({
      config: { supabaseAnonKey: "anon", supabaseUrl: origin },
      storedSession: stored(origin),
      timeoutMs: 500,
    });
    assert.equal(refreshed.session.access_token, "new-access-secret");
    assert.equal(refreshed.session.refresh_token, "new-refresh-secret");
    assert.equal(refreshed.user.id, "user-1");
  });
  assert.equal(calls, 1);
  assert.deepEqual(requestBody, { refresh_token: "old-refresh-secret" });
});

test("the first real HTTP refresh succeeds through getAuthState", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-auth-refresh-http-"));
  let calls = 0;
  try {
    await withServer((_request, response) => {
      calls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        access_token: "new-access",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "new-refresh",
        user: { email: "player@example.com", id: "user-1" },
      }));
    }, async (origin) => {
      const config = {
        sessionFileAbs: path.join(root, "userData", "session.json"),
        supabaseAnonKey: "anon",
        supabaseUrl: origin,
        userDataDir: path.join(root, "userData"),
      };
      await saveSession(config, {
        access_token: "old-access",
        expires_at: 1,
        refresh_token: "old-refresh",
      }, { email: "player@example.com", id: "user-1" });
      const state = await getAuthState(config, { fetchImpl: fetch });
      assert.equal(state.status, "ok");
      assert.equal(state.remoteUsable, true);
      assert.equal(state.sessionRevision, 2);
    });
    assert.equal(calls, 1);
  } finally {
    await fsp.rm(root, { force: true, recursive: true });
  }
});

test("structured rejection is conclusive but ambiguous 400/401/403 remain temporary", async () => {
  for (const item of [
    { body: { error_code: "refresh_token_not_found" }, expected: "revoked", status: 400 },
    { body: { error_code: "refresh_request_failed" }, expected: "temporary-failure", status: 400 },
    { body: { error: "unauthorized" }, expected: "temporary-failure", status: 401 },
    { body: { message: "refresh denied" }, expected: "temporary-failure", status: 403 },
  ]) {
    await withServer((_request, response) => {
      response.writeHead(item.status, { "content-type": "application/json" });
      response.end(JSON.stringify(item.body));
    }, async (origin) => {
      await assert.rejects(
        () => refreshProviderSession({
          config: { supabaseAnonKey: "anon", supabaseUrl: origin },
          storedSession: stored(origin),
          timeoutMs: 500,
        }),
        (error) => {
          assert.equal(error.sessionStatus, item.expected);
          return true;
        },
      );
    });
  }
});

test("429 exposes bounded Retry-After without retaining response bodies", async () => {
  await withServer((_request, response) => {
    response.writeHead(429, { "content-type": "application/json", "retry-after": "7" });
    response.end(JSON.stringify({ error_code: "rate_limit", refresh_token: "must-not-survive" }));
  }, async (origin) => {
    await assert.rejects(
      () => refreshProviderSession({
        config: { supabaseAnonKey: "anon", supabaseUrl: origin },
        storedSession: stored(origin),
        timeoutMs: 500,
      }),
      (error) => {
        assert.equal(error.sessionStatus, "temporary-failure");
        assert.equal(error.retryAfterMs, 7000);
        assert.equal(JSON.stringify(error).includes("must-not-survive"), false);
        return true;
      },
    );
  });
});

test("the refresh deadline covers a body that never completes", async () => {
  await withServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"access_token":"partial');
  }, async (origin) => {
    const startedAt = Date.now();
    await assert.rejects(
      () => requestProviderRefresh(
        { supabaseAnonKey: "anon", supabaseUrl: origin },
        "refresh-secret",
        null,
        { timeoutMs: 40 },
      ),
      (error) => {
        assert.equal(error.failureType, "timeout");
        return true;
      },
    );
    assert.ok(Date.now() - startedAt < 500);
  });
});

test("a provider redirect is rejected without forwarding the refresh token", async () => {
  let destinationCalls = 0;
  await withServer((_request, destinationResponse) => {
    destinationCalls += 1;
    destinationResponse.writeHead(200, { "content-type": "application/json" });
    destinationResponse.end("{}");
  }, async (destinationOrigin) => {
    await withServer((_request, sourceResponse) => {
      sourceResponse.writeHead(307, { location: `${destinationOrigin}/capture` });
      sourceResponse.end();
    }, async (sourceOrigin) => {
      await assert.rejects(() => requestProviderRefresh(
        { supabaseAnonKey: "anon", supabaseUrl: sourceOrigin },
        "never-forward-this-refresh-token",
        null,
        { timeoutMs: 200 },
      ));
    });
  });
  assert.equal(destinationCalls, 0);
});

test("an injected SDK that ignores AbortSignal is still bounded", async () => {
  await assert.rejects(
    () => refreshProviderSession({
      config: { supabaseAnonKey: "anon", supabaseUrl: "https://project.supabase.co" },
      storedSession: stored("https://project.supabase.co"),
      supabaseClient: { auth: { refreshSession: async () => new Promise(() => {}) } },
      timeoutMs: 20,
    }),
    (error) => {
      assert.equal(error.sessionStatus, "temporary-failure");
      assert.equal(classifySessionRefreshError(error).transient, true);
      return true;
    },
  );
});
