const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLauncherStateAuthority } = require("../src/launcher-state-authority");
const { createPlayTimeRecorder } = require("../src/playtime-recorder");
const { formatPlayTime } = require("../src/playtime-format");
const { createPlayTimeStore } = require("../src/playtime-store");
const { publishPostMameConvergence } = require("../src/post-operation-convergence");

function launcherState(label, playTime, userId = "player-one") {
  return {
    game: { gameId: "space-invaders", playTime },
    library: { label, packs: [] },
    selection: { activeInstanceKey: label },
    session: { hasSession: true, userId },
  };
}

function event(eventId, durationSeconds, mode) {
  return {
    clientVersion: "test",
    durationSeconds,
    endedAt: "2026-08-19T10:47:00.000Z",
    eventId,
    gameKey: "space-invaders",
    mode,
    rom: "invaders",
    startedAt: "2026-08-19T10:00:00.000Z",
    weekId: "week-1",
  };
}

for (const mode of ["practice", "competition"]) {
  test(`post-MAME convergence makes 47 min + 360 s visible as 53 min in ${mode}, offline`, async (t) => {
    const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), `hsl-playtime-convergence-${mode}-`));
    t.after(() => fsp.rm(userDataDir, { recursive: true, force: true }));
    const store = createPlayTimeStore({ userDataDir }, "user_player-one");
    await store.recordEvent(event(
      mode === "practice"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
      2_820,
      mode,
    ));

    const { createLauncherStateGate } = await import("../gui/renderer/launcher-state-gate.js");
    const authority = createLauncherStateAuthority();
    const gate = createLauncherStateGate();
    let visible = null;
    const apply = (snapshot) => {
      const decision = gate.accept(snapshot);
      if (decision.accepted) visible = snapshot;
      return decision;
    };

    apply(authority.publishSnapshot(launcherState("initial", "47 min")));
    const longActionRevision = authority.reserveRevision();
    const backgroundRevision = authority.reserveRevision();
    assert.equal(authority.acceptEffects(backgroundRevision), true);
    apply(authority.publishSnapshot(launcherState("background", "47 min"), backgroundRevision));

    let monotonic = 0n;
    const recorder = createPlayTimeRecorder({
      dateNow: () => new Date("2026-08-19T11:00:00.000Z"),
      monotonicNow: () => monotonic,
      randomUUID: () => mode === "practice"
        ? "33333333-3333-4333-8333-333333333333"
        : "44444444-4444-4444-8444-444444444444",
    });
    const session = recorder.prepare({
      clientVersion: "test",
      gameKey: "space-invaders",
      mode,
      playerKey: "user_player-one",
      rom: "invaders",
      store,
      userId: "player-one",
      weekId: "week-1",
    });
    await session.onSpawn();
    monotonic = 360_000_000_000n;
    await session.onClose(mode === "practice" ? 0 : 7);

    const summary = await store.readSummary();
    const finalState = launcherState("post-mame", formatPlayTime(summary.games["space-invaders"].totalSeconds));
    const result = {
      mameSpawned: true,
      ok: mode === "practice",
      phase: "mame-closed",
      state: finalState,
    };
    const convergence = await publishPostMameConvergence(result, {
      authority,
      publishSnapshot: apply,
    });

    assert.equal(convergence.published, true);
    assert.ok(convergence.revision > backgroundRevision);
    assert.equal(visible.game.playTime, "53 min");
    assert.equal(visible.selection.activeInstanceKey, "post-mame");

    const originalResponse = authority.publishResult({
      state: launcherState("old-account-selection", "47 min", "old-player"),
    }, longActionRevision);
    assert.equal(apply(originalResponse.state).reason, "stale-revision");
    assert.equal(visible.game.playTime, "53 min");
    assert.equal(visible.session.userId, "player-one");
    assert.equal(visible.selection.activeInstanceKey, "post-mame");
    assert.equal(gate.getDiagnostics().highestRevision, convergence.revision);
  });
}

test("preflight rejection never reserves or publishes post-MAME convergence", async () => {
  const authority = createLauncherStateAuthority();
  let publications = 0;
  const before = authority.getDiagnostics();
  const result = await publishPostMameConvergence({
    mameSpawned: false,
    phase: "preflight-rejected",
    state: launcherState("preflight", "47 min"),
  }, {
    authority,
    publishSnapshot: () => { publications += 1; },
  });

  assert.deepEqual(result, { published: false, reason: "not-completed-mame" });
  assert.deepEqual(authority.getDiagnostics(), before);
  assert.equal(publications, 0);
});

test("a newer account/context effect during preparation supersedes convergence", async () => {
  const authority = createLauncherStateAuthority();
  const original = authority.reserveRevision();
  assert.equal(authority.acceptEffects(original), true);
  let publications = 0;
  const result = await publishPostMameConvergence({
    mameSpawned: true,
    phase: "mame-closed",
    state: launcherState("old-selection", "53 min", "old-player"),
  }, {
    authority,
    prepareState: async (state) => {
      const accountChange = authority.reserveRevision();
      assert.equal(authority.acceptEffects(accountChange), true);
      authority.publishSnapshot(launcherState("new-selection", "No jugado", "new-player"), accountChange);
      return state;
    },
    publishSnapshot: () => { publications += 1; },
  });

  assert.equal(result.published, false);
  assert.equal(result.reason, "superseded");
  assert.equal(publications, 0);
});
