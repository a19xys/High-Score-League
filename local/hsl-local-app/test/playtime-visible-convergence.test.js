const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createAccountSessionRepository } = require("../src/account-session-repository");
const { createLauncherStateAuthority } = require("../src/launcher-state-authority");
const { setPackDirectory } = require("../src/pack-directory");
const { createPlayTimeRecorder } = require("../src/playtime-recorder");
const { createPlayTimeStore } = require("../src/playtime-store");
const { publishPostMameConvergence } = require("../src/post-operation-convergence");
const service = require("../gui/launcher-service");

const PLAYER_KEY = "user_player-one";
const GAME_ID = "space-invaders";

async function fixture(t, label) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `hsl-visible-playtime-${label}-`));
  t.after(async () => {
    service.setCompetitionAuthorityProvider(null);
    service.resetLibrarySnapshotAuthorityForTests();
    await fsp.rm(root, { recursive: true, force: true });
  });
  const userDataDir = path.join(root, "userData");
  const libraryRoot = path.join(root, "library");
  const packRoot = path.join(libraryRoot, "Space Invaders");
  const mameRoot = path.join(packRoot, "mame");
  const config = {
    appDir: root,
    clientVersion: "0.2.0-test",
    eventsBaseDirAbs: path.join(userDataDir, "events"),
    eventsFailedDirAbs: path.join(userDataDir, "events", "failed"),
    eventsPendingDirAbs: path.join(userDataDir, "events", "pending"),
    eventsSentDirAbs: path.join(userDataDir, "events", "sent"),
    sessionFileAbs: path.join(userDataDir, "session.json"),
    supabaseAnonKey: "anon-key",
    supabaseUrl: "https://offline.invalid",
    userDataDir,
    webBaseUrl: "https://offline.invalid",
  };
  await Promise.all([
    fsp.mkdir(path.join(mameRoot, "plugins", "hsl-score"), { recursive: true }),
    fsp.mkdir(config.eventsPendingDirAbs, { recursive: true }),
    fsp.mkdir(config.eventsFailedDirAbs, { recursive: true }),
    fsp.mkdir(config.eventsSentDirAbs, { recursive: true }),
  ]);
  await fsp.writeFile(path.join(mameRoot, "mame.exe"), "fixture", "utf8");
  await fsp.writeFile(path.join(packRoot, "pack.json"), JSON.stringify({
    gameId: GAME_ID,
    mame: {
      pluginName: "hsl-score",
      relativeExecutablePath: "mame/mame.exe",
      workingDir: "mame",
    },
    packId: "space-invaders-week-1",
    packVersion: 1,
    plugin: { name: "hsl-score" },
    rom: "invaders",
    webBaseUrl: "https://offline.invalid",
    weekId: "week-1",
  }), "utf8");
  await setPackDirectory(config, libraryRoot);
  const repository = createAccountSessionRepository({ config });
  await repository.saveLogin({
    schemaVersion: 1,
    session: {
      access_token: "offline-access",
      expires_at: Math.floor(Date.now() / 1000) + 3_600,
      refresh_token: "offline-refresh",
      token_type: "bearer",
    },
    supabaseUrl: config.supabaseUrl,
    user: { email: "player@example.test", id: "player-one" },
  });
  service.resetLibrarySnapshotAuthorityForTests();
  const store = createPlayTimeStore(config, PLAYER_KEY);
  await store.recordEvent({
    clientVersion: "test",
    durationSeconds: 2_820,
    endedAt: "2026-08-19T10:47:00.000Z",
    eventId: "11111111-1111-4111-8111-111111111111",
    gameKey: GAME_ID,
    mode: "practice",
    rom: "invaders",
    startedAt: "2026-08-19T10:00:00.000Z",
    weekId: "week-1",
  });
  await store.acknowledge("11111111-1111-4111-8111-111111111111");
  const initialState = await service.getLauncherState({
    config,
    deferRemoteMembership: true,
    refreshLibrary: true,
  });
  assert.equal(initialState.game.playTime, "47 min");
  return { config, initialState, store };
}

function fakeMameRun({ exitCode, monotonic, spawned = true }) {
  return async (_config, _rom, _mode, _spawn, lifecycle) => {
    if (!spawned) throw Object.assign(new Error("spawn failed"), { code: "ENOENT" });
    await lifecycle.onSpawn();
    monotonic.value = 360_000_000_000n;
    await lifecycle.onClose(exitCode);
    return exitCode;
  };
}

function recorderFor(mode, monotonic) {
  return createPlayTimeRecorder({
    dateNow: () => new Date("2026-08-19T11:00:00.000Z"),
    monotonicNow: () => monotonic.value,
    randomUUID: () => mode === "practice"
      ? "22222222-2222-4222-8222-222222222222"
      : "33333333-3333-4333-8333-333333333333",
  });
}

async function renderAcceptedConvergence(initialState, result) {
  const [{ createLauncherStateGate }, { createRegionRenderer }, { renderGameIdentityRegion }] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "launcher-state-gate.js"))),
    import(pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "region-renderer.js"))),
    import(pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "components", "game-panel.js"))),
  ]);
  const authority = createLauncherStateAuthority();
  const gate = createLauncherStateGate();
  const gameRegion = { html: "", writes: 0 };
  const libraryRegion = { html: "stable-cards", scrollTop: 317, writes: 0 };
  const renderer = createRegionRenderer({
    findRegion: (name) => name === "game-identity" ? gameRegion : libraryRegion,
    writeRegion(region, html) {
      region.html = html;
      region.writes += 1;
    },
  });
  const initial = authority.publishSnapshot(initialState);
  assert.equal(gate.accept(initial).accepted, true);
  renderer.prime("game-identity", renderGameIdentityRegion({ data: initial }));
  renderer.prime("library-packs", libraryRegion.html);
  const initialSelection = initial.selection.activeInstanceKey;
  const convergence = await publishPostMameConvergence(result, {
    authority,
    publishSnapshot(snapshot) {
      if (!gate.accept(snapshot).accepted) return;
      renderer.render("game-identity", renderGameIdentityRegion({ data: snapshot }));
    },
  });
  return { convergence, gameRegion, initialSelection, libraryRegion };
}

// This fixture intentionally exercises a legacy v1 pack. Such packs remain
// usable for Practice but cannot acquire protected Competition authority.
for (const { exitCode, mode } of [{ exitCode: 0, mode: "practice" }]) {
  test(`launcher-service derives and renders 47 min + 360 s as 53 min after ${mode} exit ${exitCode}, offline`, async (t) => {
    const { config, initialState, store } = await fixture(t, `${mode}-${exitCode}`);
    const monotonic = { value: 0n };
    const playTimeRecorder = recorderFor(mode, monotonic);
    const launchMameImpl = fakeMameRun({ exitCode, monotonic });
    service.setCompetitionAuthorityProvider({
      getContext: () => ({ connected: false }),
      getWeekCapability: (weekId) => ({
        canPlayCompetition: true,
        conclusive: true,
        publicState: "active",
        reason: "week-active",
        seasonId: "season-1",
        weekId,
      }),
    });
    const options = {
      config,
      launchMameImpl,
      playTimeRecorder,
      ...(mode === "competition" ? {
        confirmedCompetition: {
          membership: {
            canPlayCompetition: true,
            canSubmit: true,
            effectiveStatus: "member",
            message: "Participación confirmada.",
            status: "member",
          },
          weekCapability: {
            canPlayCompetition: true,
            conclusive: true,
            publicState: "active",
            reason: "week-active",
            seasonId: "season-1",
            weekId: "week-1",
          },
        },
      } : {}),
    };
    const result = mode === "practice"
      ? await service.playPractice(options)
      : await service.playCompetition(options);

    assert.equal(result.mameSpawned, true);
    assert.equal(result.phase, "mame-closed");
    assert.equal(result.exitCode, exitCode);
    assert.equal(result.ok, exitCode === 0);
    assert.equal(result.state.game.playTime, "53 min");
    assert.equal(result.state.selection.activeInstanceKey, initialState.selection.activeInstanceKey);
    const summary = await store.readSummary();
    assert.equal(summary.games[GAME_ID].totalSeconds, 3_180);
    assert.equal((await store.listPending()).length, 1, "the local UI converges before any remote ACK");

    const rendered = await renderAcceptedConvergence(initialState, result);
    assert.equal(rendered.convergence.published, true);
    assert.match(rendered.gameRegion.html, /game-metadata-item--playtime/);
    assert.match(rendered.gameRegion.html, />53 min<\/strong>/);
    assert.equal(rendered.gameRegion.writes, 1);
    assert.equal(rendered.libraryRegion.writes, 0);
    assert.equal(rendered.libraryRegion.scrollTop, 317);
    assert.equal(result.state.selection.activeInstanceKey, rendered.initialSelection);
  });
}

test("a failed spawn records no Playtime and never qualifies for post-MAME convergence", async (t) => {
  const { config, store } = await fixture(t, "spawn-failed");
  const monotonic = { value: 0n };
  await assert.rejects(
    service.playPractice({
      config,
      launchMameImpl: fakeMameRun({ exitCode: 1, monotonic, spawned: false }),
      playTimeRecorder: recorderFor("practice", monotonic),
    }),
    /spawn failed/,
  );
  const summary = await store.readSummary();
  assert.equal(summary.games[GAME_ID].totalSeconds, 2_820);
  assert.equal((await store.listPending()).length, 0);
});
