const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { launchMame } = require("../src/mame-launcher");
const {
  competitionAttemptFromState,
  membershipResolutionBlocksCompetition,
  runCompetitionPlayPreflight,
} = require("../src/competition-play-preflight");

function state(overrides = {}) {
  return {
    activePack: { packId: "pack-artifact-a", revisionManaged: false, title: "Game A" },
    competitionAccess: { canPlayCompetition: true },
    game: { weekId: "week-a" },
    membership: { effectiveStatus: "member", status: "member" },
    readiness: { canPractice: true, message: "Listo." },
    selection: { activeInstanceKey: "pack-a" },
    session: { hasSession: true, userId: "user-a" },
    weekCapability: { publicState: "active", weekId: "week-a" },
    ...overrides,
  };
}

function authority(overrides = {}) {
  return {
    authorityKey: "launcher-api:1",
    connected: true,
    origin: "https://hsl.example",
    reachabilityGeneration: 4,
    ...overrides,
  };
}

test("preflight online ACTIVE lanza una vez con fingerprint congelado", async () => {
  let launches = 0;
  let checks = 0;
  const current = state();
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => { checks += 1; return { ok: true }; },
    getAuthorityContext: () => authority(),
    getState: async () => current,
    launch: async ({ confirmedCompetition, expectedCompetitionAttempt }) => {
      launches += 1;
      assert.deepEqual(expectedCompetitionAttempt, competitionAttemptFromState(current, authority()));
      assert.equal(confirmedCompetition.membership.status, "member");
      assert.equal(confirmedCompetition.weekCapability.publicState, "active");
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(checks, 1);
  assert.equal(launches, 1);
});

test("cambiar build/environment compatible durante preflight no cambia la competición", async () => {
  let launches = 0;
  let deployment = { apiVersion: 1, build: "build-a", environment: "production" };
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => {
      deployment = { apiVersion: 1, build: "build-b", environment: "preview" };
      return { ok: true };
    },
    getAuthorityContext: () => ({ ...authority(), deployment }),
    getState: async () => state(),
    launch: async () => { launches += 1; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(launches, 1);
});

test("ACTIVE + member + sesión canónica estable alcanza el spawn real de MAME", async () => {
  let spawns = 0;
  const previousLog = console.log;
  console.log = () => {};
  try {
    const result = await runCompetitionPlayPreflight({
      ensureFreshCapability: async () => ({ ok: true }),
      getAuthorityContext: () => authority(),
      getState: async () => state(),
      launch: async () => {
        const code = await launchMame({
          mame: {
            executablePath: "C:/MAME/mame.exe",
            pluginName: "hsl-score",
            workingDir: "C:/MAME",
          },
        }, "invaders", "competition", () => {
          spawns += 1;
          const child = new EventEmitter();
          queueMicrotask(() => {
            child.emit("spawn");
            child.emit("close", 0);
          });
          return child;
        });
        return { ok: code === 0 };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(spawns, 1);
  } finally {
    console.log = previousLog;
  }
});

test("una revalidación equivalente de membership no bloquea un entitlement member ya confirmado", async () => {
  let reads = 0;
  let launches = 0;
  const initial = state();
  const checking = state({
    competitionAccess: { canPlayCompetition: true, reason: "competition-ready" },
    membership: { effectiveStatus: "member", status: "checking", technicalReason: "membership-request-active" },
    readiness: { canPlayCompetition: true, canPractice: true, message: "Comprobando participación." },
  });
  assert.equal(membershipResolutionBlocksCompetition(checking, true), false);
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => ({ ok: true }),
    getAuthorityContext: () => authority(),
    getState: async () => (++reads === 1 ? initial : checking),
    launch: async ({ confirmedCompetition }) => {
      launches += 1;
      assert.equal(confirmedCompetition.competitionAccess.canPlayCompetition, true);
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(launches, 1);
});

test("membership checking sin entitlement previo sigue bloqueando JUGAR", () => {
  const checking = state({
    competitionAccess: { canPlayCompetition: false, reason: "membership-unknown" },
    membership: { status: "checking" },
    readiness: { canPlayCompetition: false, canPractice: true },
  });
  assert.equal(membershipResolutionBlocksCompetition(checking, true), true);
  assert.equal(membershipResolutionBlocksCompetition(checking, false), false);
});

for (const publicState of ["closed", "inactive", "unlinked"]) {
  test(`preflight online ${publicState.toUpperCase()} bloquea MAME y conserva Practicar`, async () => {
    let reads = 0;
    let launches = 0;
    const initial = state();
    const corrected = state({
      competitionAccess: { canPlayCompetition: false, canPractice: true },
      weekCapability: { publicState, weekId: "week-a" },
    });
    const result = await runCompetitionPlayPreflight({
      ensureFreshCapability: async () => ({ ok: true }),
      getAuthorityContext: () => authority(),
      getState: async () => (++reads === 1 ? initial : corrected),
      launch: async () => { launches += 1; return { ok: true }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.state.weekCapability.publicState, publicState);
    assert.equal(result.state.readiness.canPractice, true);
    assert.match(result.lines[0], /practicar/i);
    assert.equal(launches, 0);
  });
}

test("fallo temporal online no usa ACTIVE cacheada ni inventa reautenticacion", async () => {
  let launches = 0;
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => ({ ok: false, reason: "timeout" }),
    getAuthorityContext: () => authority(),
    getState: async () => state(),
    launch: async () => { launches += 1; return { ok: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "preflight-rejected");
  assert.equal(result.launchAttempted, false);
  assert.equal(result.mameSpawned, false);
  assert.equal(result.reason, "week-refresh-failed");
  assert.equal(result.cause, "timeout");
  assert.deepEqual(result.technicalDetails, ["week-refresh-failed", "cause=timeout"]);
  assert.match(result.lines[0], /No se pudo confirmar.*Puedes practicar/i);
  assert.doesNotMatch(result.lines[0], /sesi[oó]n|login/i);
  assert.equal(launches, 0);
});

test("API incompatible bloquea antes de launch y conserva la causa técnica", async () => {
  let launches = 0;
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => ({ ok: false, reason: "unsupported-contract" }),
    getAuthorityContext: () => authority(),
    getState: async () => state(),
    launch: async () => { launches += 1; return { ok: true }; },
  });
  assert.equal(result.reason, "week-refresh-failed");
  assert.equal(result.cause, "unsupported-contract");
  assert.deepEqual(result.technicalDetails, ["week-refresh-failed", "cause=unsupported-contract"]);
  assert.equal(launches, 0);
});

test("offline confirmado usa la autoridad durable sin request remoto", async () => {
  let checks = 0;
  let launches = 0;
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => { checks += 1; return { ok: false }; },
    getAuthorityContext: () => authority({ connected: false }),
    getState: async () => state(),
    launch: async () => { launches += 1; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(checks, 0);
  assert.equal(launches, 1);
});

test("Protected offline no acepta cache durable y conserva Practice", async () => {
  let checks = 0;
  let launches = 0;
  const managed = state({
    activePack: { packId: "pack-artifact-a", revisionManaged: true, title: "Game A" },
    readiness: { canPractice: true, revisionManaged: true },
  });
  const result = await runCompetitionPlayPreflight({
    ensureFreshCapability: async () => { checks += 1; return { ok: true }; },
    getAuthorityContext: () => authority({ connected: false }),
    getState: async () => managed,
    launch: async () => { launches += 1; return { ok: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "pack-currentness-unknown");
  assert.equal(result.state.readiness.canPractice, true);
  assert.match(result.lines[0], /Conéctate a High Score League/);
  assert.equal(checks, 0);
  assert.equal(launches, 0);
});

for (const mutation of [
  { label: "packId en el mismo path", state: { activePack: { packId: "pack-artifact-b", revisionManaged: false, title: "Game A" } } },
  { label: "pack", state: { selection: { activeInstanceKey: "pack-b" } } },
  { label: "cuenta", state: { session: { hasSession: true, userId: "user-b" } } },
  { label: "week", state: { game: { weekId: "week-b" }, weekCapability: { publicState: "active", weekId: "week-b" } } },
  { label: "autoridad API", authority: { authorityKey: "launcher-api:2" } },
  { label: "origin", authority: { origin: "https://other-hsl.example" } },
  { label: "generación de conectividad", authority: { reachabilityGeneration: 5 } },
]) {
  test(`respuesta stale tras cambio de ${mutation.label} no lanza MAME`, async () => {
    let reads = 0;
    let launches = 0;
    let currentAuthority = authority();
    const initial = state();
    const changed = state(mutation.state || {});
    const result = await runCompetitionPlayPreflight({
      ensureFreshCapability: async () => {
        currentAuthority = authority(mutation.authority || {});
        return { ok: true };
      },
      getAuthorityContext: () => currentAuthority,
      getState: async () => (++reads === 1 ? initial : changed),
      launch: async () => { launches += 1; return { ok: true }; },
    });
    assert.equal(result.ok, false);
    assert.match(result.lines[0], /han cambiado/i);
    assert.equal(launches, 0);
  });
}
