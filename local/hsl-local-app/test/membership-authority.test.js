const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { checkSeasonMembership } = require("../src/season-membership");
const { createSessionResult } = require("../src/session-result");

async function withTempDir(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-membership-authority-"));
  try { return await run(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

function config(userDataDir) {
  return {
    defaultWeekId: "week-a",
    supabaseUrl: "https://project.supabase.co",
    userDataDir,
    webBaseUrl: "https://hsl.example",
  };
}

function session(userId, token = "token-a", status = "valid") {
  return createSessionResult({
    sessionRevision: 1,
    status,
    storedSession: {
      supabaseUrl: "https://project.supabase.co",
      session: { access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600 },
      user: { id: userId },
    },
  });
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const authorityContext = { authorityKey: "launcher-api:1", origin: "https://hsl.example" };
const weekCapability = { publicState: "active", seasonId: "season-a", weekId: "week-a" };

test("member concluyente sobrevive timeout/offline y nunca autoriza otra cuenta", async () => {
  await withTempDir(async (userDataDir) => {
    const base = config(userDataDir);
    const member = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
      authorityContext,
      fetchImpl: async () => response(200, { status: "member", seasonId: "season-a", weekId: "week-a" }),
      sessionResult: session("user-a"),
      weekCapability,
    });
    assert.equal(member.status, "member");
    assert.equal(member.effectiveSource, "remote-conclusive");

    const temporary = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
      authorityContext,
      fetchImpl: async () => { throw new Error("offline"); },
      sessionResult: session("user-a"),
      weekCapability,
    });
    assert.equal(temporary.status, "member");
    assert.equal(temporary.canPlayCompetition, true);
    assert.equal(temporary.canSubmit, false);
    assert.equal(temporary.effectiveSource, "durable-cache");

    const other = await checkSeasonMembership(base, { hasSession: true, userId: "user-b" }, {
      authorityContext,
      deferRemote: true,
      sessionResult: session("user-b", "token-b"),
      weekCapability,
    });
    assert.equal(other.status, "unknown");
    assert.equal(other.canPlayCompetition, false);
  });
});

test("not_member online sustituye member durable", async () => {
  await withTempDir(async (userDataDir) => {
    const base = config(userDataDir);
    const common = { authorityContext, sessionResult: session("user-a"), weekCapability };
    await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
      ...common,
      fetchImpl: async () => response(200, { status: "member", seasonId: "season-a", weekId: "week-a" }),
    });
    await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
      ...common,
      fetchImpl: async () => response(200, { status: "not_member", seasonId: "season-a", weekId: "week-a" }),
    });
    const offline = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, { ...common, deferRemote: true });
    assert.equal(offline.status, "not_member");
    assert.equal(offline.canPlayCompetition, false);
  });
});

test("member durable obtenido en build A permanece bajo build B compatible", async () => {
  await withTempDir(async (userDataDir) => {
    const base = config(userDataDir);
    await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
      authorityContext: { ...authorityContext, deployment: { apiVersion: 1, build: "build-a", environment: "production" } },
      fetchImpl: async () => response(200, { status: "member", seasonId: "season-a", weekId: "week-a" }),
      sessionResult: session("user-a"),
      weekCapability,
    });
    const underBuildB = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
      authorityContext: { ...authorityContext, deployment: { apiVersion: 1, build: "build-b", environment: "preview" } },
      deferRemote: true,
      sessionResult: session("user-a"),
      weekCapability,
    });
    assert.equal(underBuildB.status, "member");
    assert.equal(underBuildB.effectiveSource, "durable-cache");
  });
});

test("401 terminal, temporal y doble 401 respetan exclusivamente la sesion canonica", async () => {
  const base = config(null);
  const revoked = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
    fetchImpl: async () => response(401, { status: "unauthenticated" }),
    resolveCanonicalSessionResultImpl: async () => createSessionResult({ status: "revoked" }),
    sessionResult: session("user-a"),
  });
  assert.equal(revoked.status, "unauthenticated");

  const deferred = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
    fetchImpl: async () => response(401, { status: "unauthenticated" }),
    resolveCanonicalSessionResultImpl: async () => createSessionResult({ status: "lock-timeout", storedSession: session("user-a").storedSession }),
    sessionResult: session("user-a"),
  });
  assert.equal(deferred.status, "unknown");
  assert.equal(deferred.authDeferred, true);

  let requests = 0;
  let refreshes = 0;
  const rejected = await checkSeasonMembership(base, { hasSession: true, userId: "user-a" }, {
    fetchImpl: async () => { requests += 1; return response(401, { status: "unauthenticated" }); },
    resolveCanonicalSessionResultImpl: async () => { refreshes += 1; return session("user-a", "fresh-token", "refreshed"); },
    sessionResult: session("user-a"),
  });
  assert.equal(requests, 2);
  assert.equal(refreshes, 1);
  assert.equal(rejected.status, "unknown");
  assert.equal(rejected.sessionStatus, "refreshed");
  assert.equal(rejected.technicalReason, "credential-rejected-after-canonical-refresh");
});
