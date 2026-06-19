const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkSeasonMembership,
  getMembershipUrl,
  normalizeMembershipResponse,
  shouldBlockCompetition,
  shouldBlockSubmit,
} = require("../src/season-membership");

function config(overrides = {}) {
  return {
    defaultWeekId: "week-1",
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
    session: {
      access_token: token,
    },
    user: {
      id: "user-1",
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
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

test("sin weekId devuelve missing_week", async () => {
  const result = await checkSeasonMembership(config({ defaultWeekId: null }), sessionState(), {
    storedSession: storedSession(),
  });

  assert.equal(result.status, "missing_week");
  assert.equal(result.canPlayCompetition, false);
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
    storedSession: storedSession(),
  });

  assert.equal(authorization, "Bearer secret-access-token");
  assert.equal(result.status, "member");
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, true);
  assert.equal(result.joinUrl, "https://high-score-league.example/seasons/season-1");
  assert.equal(JSON.stringify(result).includes("secret-access-token"), false);
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
    storedSession: storedSession(),
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
    storedSession: storedSession(),
  });

  assert.equal(result.status, "unauthenticated");
  assert.equal(result.canPlayCompetition, false);
});

test("error de red devuelve unknown y permite competir con advertencia", async () => {
  const result = await checkSeasonMembership(config(), sessionState(), {
    fetchImpl: async () => {
      throw new Error("network down");
    },
    storedSession: storedSession(),
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.canPlayCompetition, true);
  assert.equal(result.canSubmit, false);
  assert.match(result.message, /No se pudo comprobar/);
  assert.equal(shouldBlockCompetition(result), false);
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
