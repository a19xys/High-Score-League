const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkSeasonMembership,
  getMembershipUrl,
  normalizeMembershipResponse,
  safeMembershipJoinUrl,
  shouldBlockCompetition,
  shouldBlockSubmit,
} = require("../src/season-membership");
const { createSessionResult } = require("../src/session-result");

function config(overrides = {}) {
  return {
    defaultWeekId: "week-1",
    supabaseUrl: "https://project.supabase.co",
    webBaseUrl: "https://high-score-league.example",
    ...overrides,
  };
}

function sessionState() {
  return {
    hasSession: true,
    userId: "user-1",
  };
}

function storedSession(token = "secret-access-token") {
  return {
    supabaseUrl: "https://project.supabase.co",
    session: {
      access_token: token,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
    user: {
      id: "user-1",
    },
  };
}

function remoteSessionResult(token = "secret-access-token", overrides = {}) {
  return createSessionResult({
    sessionRevision: 1,
    status: "valid",
    storedSession: storedSession(token),
    ...overrides,
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(status, body, contentType = "text/html") {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
    },
  });
}

test("sin sesion devuelve no_session y bloquea competicion", async () => {
  const result = await checkSeasonMembership(config(), { hasSession: false });

  assert.equal(result.status, "no_session");
  assert.equal(result.canPlayCompetition, false);
  assert.equal(result.canSubmit, false);
  assert.equal(shouldBlockCompetition(result), true);
});

test("requiresLogin canonico devuelve unauthenticated sin una peticion remota", async () => {
  let fetched = false;
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not run");
    },
    sessionResult: createSessionResult({ sessionRevision: 3, status: "revoked" }),
  });

  assert.equal(fetched, false);
  assert.equal(result.status, "unauthenticated");
  assert.equal(result.canPlayCompetition, false);
  assert.match(result.message, /sesion no es valida/i);
  assert.equal(result.technicalReason, "auth-required:revoked");
  assert.equal(result.sessionRevision, 3);
});

test("sin weekId devuelve missing_week", async () => {
  const result = await checkSeasonMembership(config({ defaultWeekId: null }), sessionState(), {
    sessionResult: remoteSessionResult(),
  });

  assert.equal(result.status, "missing_week");
  assert.equal(result.canPlayCompetition, false);
});

test("deferred membership returns immediately without a remote request", async () => {
  let fetched = false;
  const result = await checkSeasonMembership(config(), sessionState(), {
    deferRemote: true,
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not run");
    },
  });

  assert.equal(fetched, false);
  assert.equal(result.status, "unknown");
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, false);
  assert.equal(result.checkedAt, null);
  assert.equal(result.request, null);
  assert.equal(result.technicalReason, "deferred");
});

test("respuesta member permite competicion y subida", async () => {
  let authorization = null;
  const result = await checkSeasonMembership(config(), sessionState(), {
    checkedAt: "2026-06-19T00:00:00.000Z",
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return jsonResponse(200, {
        ok: true,
        status: "member",
        weekId: "week-1",
        seasonId: "season-1",
        joinUrl: "/seasons/season-1",
        message: "Participas en esta temporada.",
      });
    },
    sessionResult: remoteSessionResult(),
  });

  assert.equal(authorization, "Bearer secret-access-token");
  assert.equal(result.status, "member");
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, true);
  assert.equal(result.joinUrl, "https://high-score-league.example/seasons/season-1");
  assert.equal(result.request.url, "https://high-score-league.example/api/local/season-membership?weekId=week-1");
  assert.equal(result.request.method, "GET");
  assert.equal(result.response.httpStatus, 200);
  assert.equal(result.response.bodyStatus, "member");
  assert.equal(result.response.bodyMessage, "server_message");
  assert.equal(JSON.stringify(result).includes("secret-access-token"), false);
  assert.equal(JSON.stringify(result).includes("Authorization"), false);
});

test("respuesta not_member bloquea competicion y subida", async () => {
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => jsonResponse(200, {
      ok: true,
      status: "not_member",
      weekId: "week-1",
      seasonId: "season-1",
      joinUrl: "/seasons/season-1",
    }),
    sessionResult: remoteSessionResult(),
  });

  assert.equal(result.status, "not_member");
  assert.equal(result.canPlayCompetition, false);
  assert.equal(result.canSubmit, false);
  assert.equal(shouldBlockCompetition(result), true);
  assert.equal(shouldBlockSubmit(result), true);
});

test("endpoint 401 devuelve unauthenticated", async () => {
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => jsonResponse(401, {
      ok: false,
      status: "unauthenticated",
      message: "Necesitas una sesion valida.",
    }),
    sessionResult: remoteSessionResult(),
  });

  assert.equal(result.status, "unauthenticated");
  assert.equal(result.canPlayCompetition, false);
  assert.equal(result.response.httpStatus, 401);
  assert.equal(result.response.bodyStatus, "unauthenticated");
});

test("respuesta 500 JSON error devuelve error diagnostico", async () => {
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => jsonResponse(500, {
      ok: false,
      status: "error",
      message: "No se pudo comprobar la participacion.",
    }),
    sessionResult: remoteSessionResult(),
  });

  assert.equal(result.status, "error");
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, false);
  assert.equal(result.response.httpStatus, 500);
  assert.equal(result.response.bodyStatus, "error");
  assert.match(result.technicalReason, /HTTP 500/);
});

test("respuesta HTML no guarda HTML completo y devuelve error seguro", async () => {
  const html = "<html><body><h1>Not Found</h1><script>secret</script></body></html>";
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => textResponse(404, html),
    sessionResult: remoteSessionResult("very-secret-token"),
  });

  const serialized = JSON.stringify(result);

  assert.equal(result.status, "error");
  assert.equal(result.response.httpStatus, 404);
  assert.equal(result.response.bodyStatus, "non_json_response");
  assert.equal(result.response.bodyMessage, "non_json_response");
  assert.match(result.technicalReason, /non_json_response/);
  assert.equal(serialized.includes("<html>"), false);
  assert.equal(serialized.includes("very-secret-token"), false);
});

test("error de red devuelve unknown y permite competir con advertencia", async () => {
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => {
      throw new Error("network down");
    },
    sessionResult: remoteSessionResult(),
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, false);
  assert.match(result.message, /No se pudo comprobar/);
  assert.equal(shouldBlockCompetition(result), false);
  assert.equal(result.request.url, "https://high-score-league.example/api/local/season-membership?weekId=week-1");
  assert.equal(result.response, null);
  assert.equal(result.technicalReason, "transport-failure:request-failed");
  assert.equal(result.remoteFailure, "transport-failure");
});

test("deferred con un access token expirado preservado no envia Authorization", async () => {
  let fetched = false;
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not run");
    },
    sessionResult: createSessionResult({
      reason: "refresh-provider-unavailable",
      sessionRevision: 4,
      status: "deferred",
      storedSession: storedSession("expired-access-token"),
    }),
  });

  assert.equal(fetched, false);
  assert.equal(result.status, "unknown");
  assert.equal(result.authDeferred, true);
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, false);
  assert.equal(result.sessionStatus, "deferred");
  assert.equal(result.sessionRevision, 4);
  assert.match(result.technicalReason, /^auth-deferred:/);
  assert.doesNotMatch(JSON.stringify(result), /expired-access-token|Authorization/);
});

test("un resultado remoto antiguo se revalida justo antes de enviar Authorization", async () => {
  let fetched = false;
  const expiredAfterResolution = storedSession("expired-after-resolution");
  expiredAfterResolution.session.expires_at = 100;
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not run");
    },
    nowMs: 200_000,
    sessionResult: createSessionResult({
      sessionRevision: 5,
      status: "valid",
      storedSession: expiredAfterResolution,
    }),
  });

  assert.equal(fetched, false);
  assert.equal(result.authDeferred, true);
  assert.equal(result.status, "unknown");
  assert.equal(result.sessionStatus, "valid");
});

test("cancelled y lock-timeout son auth-deferred y nunca unauthenticated", async () => {
  for (const status of ["cancelled", "lock-timeout"]) {
    let authorizationSent = false;
    const result = await checkSeasonMembership(config(), sessionState(), {
      fetchImpl: async (_url, init) => {
        authorizationSent = Boolean(init?.headers?.Authorization);
        throw new Error("must not run");
      },
      sessionResult: createSessionResult({
        sessionRevision: 2,
        status,
        storedSession: storedSession("preserved-token"),
      }),
    });
    assert.equal(authorizationSent, false, status);
    assert.equal(result.status, "unknown", status);
    assert.equal(result.authDeferred, true, status);
    assert.equal(result.sessionStatus, status, status);
  }
});

test("legacy storedSession is ignored unless the fixture opts in explicitly", async () => {
  let fetched = false;
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not run");
    },
    resolveCanonicalSessionResultImpl: async () => createSessionResult({
      reason: "refresh-timeout",
      status: "deferred",
      storedSession: storedSession("canonical-expired-token"),
    }),
    storedSession: storedSession("legacy-fixture-token"),
  });
  assert.equal(fetched, false);
  assert.equal(result.authDeferred, true);
  assert.equal(result.status, "unknown");

  let authorization = null;
  const trusted = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async (_url, init) => {
      authorization = init.headers.Authorization;
      return jsonResponse(200, { status: "member", weekId: "week-1" });
    },
    storedSession: storedSession("trusted-fixture-token"),
    trustStoredSessionFixture: true,
  });
  assert.equal(trusted.status, "member");
  assert.equal(authorization, "Bearer trusted-fixture-token");
});

test("joinUrl accepts only the configured origin and falls back safely", () => {
  assert.equal(
    safeMembershipJoinUrl(config(), "https://high-score-league.example/seasons/one"),
    "https://high-score-league.example/seasons/one",
  );
  assert.equal(
    safeMembershipJoinUrl(config(), "https://evil.example/phishing"),
    "https://high-score-league.example",
  );
  assert.equal(
    safeMembershipJoinUrl(config(), "javascript:alert(1)"),
    "https://high-score-league.example",
  );
  const normalized = normalizeMembershipResponse(config(), {
    status: "not_member",
    joinUrl: "https://evil.example/phishing",
  });
  assert.equal(normalized.joinUrlRejected, true);
  assert.equal(normalized.joinUrl, "https://high-score-league.example");
});

test("invalid_week bloquea competicion", () => {
  const result = normalizeMembershipResponse(config(), {
    ok: false,
    status: "invalid_week",
    message: "No se encontro la semana.",
  }, {
    weekId: "week-1",
  });

  assert.equal(result.status, "invalid_week");
  assert.equal(result.canPlayCompetition, false);
});

test("getMembershipUrl construye URL local", () => {
  assert.equal(
    getMembershipUrl(config({ webBaseUrl: "https://example.test/" }), "week 1"),
    "https://example.test/api/local/season-membership?weekId=week%201",
  );
});
