const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const service = require("../gui/launcher-service");

test("launcher proyecta la misma week capability en cards, detalle y gate de JUGAR", () => {
  service.setCompetitionAuthorityProvider({
    getContext: () => ({ authorityKey: "launcher-api:1", connected: false, origin: "https://hsl.example" }),
    getWeekCapability: (weekId) => ({
      canPlayCompetition: false,
      conclusive: true,
      publicState: weekId === "week-a" ? "closed" : "unlinked",
      reason: weekId === "week-a" ? "week-closed" : "not-linked",
      seasonId: "season-a",
      weekId,
    }),
  });
  try {
    const state = service.applyCompetitionAuthorityState({
      game: { weekId: "week-a" },
      library: { packs: [{ id: "pack-a", weekId: "week-a" }] },
      membership: { canSubmit: false, status: "member" },
      readiness: {
        canCapture: true,
        canPlayCompetition: true,
        canPractice: true,
        localCompetitionReady: true,
        localSubmissionReady: true,
      },
      session: { hasSession: true, remoteUsable: false, requiresLogin: false, userId: "user-a" },
    });
    assert.equal(state.weekCapability.publicState, "closed");
    assert.equal(state.library.packs[0].weekCapability.publicState, "closed");
    assert.equal(state.competitionAccess.canPlayCompetition, false);
    assert.equal(state.competitionAccess.canPractice, true);
    assert.equal(state.readiness.canPlayCompetition, false);
  } finally {
    service.setCompetitionAuthorityProvider(null);
  }
});

test("main integra cache durable, freshness, triggers y preflight sin polling", async () => {
  const [main, launcher] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
  ]);
  assert.match(main, /createWeekCapabilitiesService/);
  assert.match(main, /weekCapabilities\.updateContext/);
  assert.match(main, /weekCapabilities\.refresh/);
  assert.match(main, /force: becameConnected \|\| manual/);
  assert.match(main, /weekCapabilities\?\.refresh\("focus"\)/);
  assert.match(main, /weekCapabilities\?\.setSuspended\(true\)/);
  assert.match(main, /weekCapabilities\?\.setSuspended\(false\)/);
  assert.match(main, /runCompetitionPlayPreflight/);
  assert.match(main, /ensureFreshCapability/);
  assert.match(main, /refreshWeekCapabilities: false/);
  assert.match(main, /setCompetitionAuthorityProvider/);
  assert.match(main, /publishWeekCapabilityState/);
  assert.match(main, /applyCompetitionAuthorityState/);
  assert.match(launcher, /weekCapability: context\.weekCapability/);
  assert.match(launcher, /authorityContext/);
  assert.match(launcher, /deriveCompetitionAccess/);
  assert.doesNotMatch(main, /setInterval\([^)]*week|week[^\n]*setInterval/i);
});

test("una semana cerrada bloquea antes de iniciar MAME competitivo", async () => {
  const launcher = await fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8");
  const competition = launcher.slice(
    launcher.indexOf("async function playCompetitionAction"),
    launcher.indexOf("async function playCompetition(options"),
  );
  assert.match(competition, /weekCapability = options\.confirmedCompetition\?\.weekCapability \|\| context\.weekCapability/);
  assert.match(competition, /expectedCompetitionAttempt/);
  assert.match(competition, /deferRemoteMembership: Boolean\(options\.confirmedCompetition\)/);
  assert.match(competition, /options\.confirmedCompetition\?\.membership \|\| context\.membership/);
  assert.match(competition, /options\.confirmedCompetition\?\.weekCapability \|\| context\.weekCapability/);
  assert.match(competition, /membership\?\.effectiveStatus \|\| membership\?\.status/);
  assert.ok(competition.indexOf("readinessBlockedResponse") < competition.indexOf("launchMameDetailed"));
  assert.ok(competition.indexOf("readinessBlockedResponse") < competition.indexOf("launchMame("));
});

test("JUGAR refresca health antes del preflight y las fases visibles nacen del lifecycle real", async () => {
  const [main, launcher, renderer] = await Promise.all([
    fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(__dirname, "..", "gui", "renderer", "app.js"), "utf8"),
  ]);
  const handler = main.slice(
    main.indexOf('registerLauncherStateHandler("launcher:play-competition"'),
    main.indexOf('registerLauncherStateHandler("launcher:practice"'),
  );
  assert.ok(handler.indexOf('prepareRemoteAction("play-preflight", { force: true })') < handler.indexOf("runCompetitionPlayPreflight"));
  assert.match(handler, /onMamePhase/);
  assert.match(handler, /mame-spawned/);
  assert.match(launcher, /options\.onMamePhase\?\.\("mame-spawned"\)/);
  assert.match(launcher, /options\.onMamePhase\?\.\("mame-closed"\)/);
  assert.match(renderer, /options\.phaseDriven !== true/);
  assert.match(renderer, /options\.closingLabel && value\?\.mameSpawned === true/);
  assert.match(renderer, /response\.technicalDetails/);
});
