const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveCompetitionAccess } = require("../src/competition-access");

function ready(overrides = {}) {
  return {
    local: { canCapture: true, canPractice: true, canSubmitLocally: true, hasCompetitionScope: true, hasWeek: true, protectedCompetitionReady: true },
    membership: { canSubmit: true, status: "member" },
    session: { hasSession: true, remoteUsable: true, requiresLogin: false, userId: "user-a" },
    week: { publicState: "active" },
    ...overrides,
  };
}

test("la decision competitiva combina cuatro autoridades sin depender de conectividad para JUGAR", () => {
  const online = deriveCompetitionAccess(ready());
  const offline = deriveCompetitionAccess(ready({
    session: { hasSession: true, remoteUsable: false, requiresLogin: false, userId: "user-a" },
  }));
  assert.equal(online.canPlayCompetition, true);
  assert.equal(online.canSubmitNow, true);
  assert.equal(offline.canPlayCompetition, true);
  assert.equal(offline.canSubmitNow, false);
});

test("PRACTICAR solo depende del pack local", () => {
  const access = deriveCompetitionAccess(ready({
    membership: { status: "unknown" },
    session: { hasSession: false, requiresLogin: false },
    week: { publicState: "unknown" },
  }));
  assert.equal(access.canPractice, true);
  assert.equal(access.canPlayCompetition, false);
});

test("not_member, unknown, semana inactiva/cerrada/desconocida y login bloquean JUGAR", () => {
  const cases = [
    [ready({ membership: { status: "not_member" } }), "not-member"],
    [ready({ membership: { status: "unknown" } }), "membership-unknown"],
    [ready({ week: { publicState: "inactive" } }), "week-inactive"],
    [ready({ week: { publicState: "closed" } }), "week-closed"],
    [ready({ week: { publicState: "unknown" } }), "week-unknown"],
    [ready({ session: { hasSession: true, requiresLogin: true, userId: "user-a" } }), "requires-login"],
    [ready({ session: { hasSession: false, requiresLogin: false } }), "no-account"],
  ];
  for (const [input, reason] of cases) {
    const result = deriveCompetitionAccess(input);
    assert.equal(result.canPlayCompetition, false, reason);
    assert.equal(result.canPractice, true, reason);
    assert.equal(result.reason, reason);
  }
});

test("un pack local roto bloquea tambien PRACTICAR", () => {
  const access = deriveCompetitionAccess(ready({
    local: { canCapture: true, canPractice: false, hasCompetitionScope: true, hasWeek: true },
  }));
  assert.equal(access.canPractice, false);
  assert.equal(access.canPlayCompetition, false);
  assert.equal(access.reasonCategory, "local");
});

test("Protected distingue current, outdated, unknown y current-unverified sin bloquear Practice", () => {
  const cases = [
    ["current", true, "competition-ready"],
    ["outdated", false, "pack-update-required"],
    ["unknown", false, "pack-currentness-unknown"],
    ["current-unverified", false, "pack-provenance-unverified"],
  ];
  for (const [revisionStatus, canPlayCompetition, reason] of cases) {
    const result = deriveCompetitionAccess(ready({
      local: {
        canPractice: true,
        canSubmitLocally: true,
        captureReady: true,
        hasCompetitionScope: true,
        hasWeek: true,
        protectedCompetitionReady: true,
        revisionManaged: true,
        revisionStatus,
      },
    }));
    assert.equal(result.canPractice, true, revisionStatus);
    assert.equal(result.canPlayCompetition, canPlayCompetition, revisionStatus);
    assert.equal(result.reason, reason, revisionStatus);
  }
});

test("freshness distingue autoridad online caducada de conocimiento durable offline", () => {
  for (const publicState of ["active", "closed"]) {
    const stale = deriveCompetitionAccess(ready({
      week: {
        authorityState: "stale-error",
        fresh: false,
        lastKnownPublicState: publicState,
        publicState,
      },
    }));
    assert.equal(stale.canPlayCompetition, false);
    assert.equal(stale.reason, "week-unknown");
    assert.equal(stale.lastKnownWeekStatus, publicState);
  }

  const offline = deriveCompetitionAccess(ready({
    session: { hasSession: true, remoteUsable: false, requiresLogin: false, userId: "user-a" },
    week: {
      authorityState: "offline-durable",
      fresh: false,
      lastKnownPublicState: "active",
      publicState: "active",
    },
  }));
  assert.equal(offline.canPlayCompetition, true);
  assert.equal(offline.canSubmitNow, false);
  assert.equal(offline.weekAuthorityState, "offline-durable");
});
