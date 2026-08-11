const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

async function presentationApi() {
  return import(pathToFileURL(path.join(rendererRoot, "product-presentation.js")).href);
}

function state(overrides = {}) {
  const base = {
    busy: false,
    busyLabel: null,
    connectivity: {
      displayStatus: "connected",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 4,
    },
    data: {
      accounts: { knownAccounts: [] },
      autoSync: { status: "idle" },
      bridge: { contractStatus: "current", deprecated: false },
      game: {
        displayName: "Pac-Man",
        manual: { available: true },
        weekId: "week-1",
      },
      library: {
        directory: { available: true, configured: true, path: "packs" },
        packs: [{ instanceKey: "pack-1" }],
        status: "available-populated",
      },
      membership: { canPlayCompetition: true, canSubmit: true, checkedAt: "2026-01-01", status: "member" },
      queue: { totals: { failed: 0, pending: 0, sent: 2 } },
      readiness: {
        blockers: [],
        canPlayCompetition: true,
        canPractice: true,
        checks: [],
        status: "ready",
      },
      remoteConfiguration: { status: "configured" },
      selection: { activeInstanceKey: "pack-1" },
      session: { hasSession: true, remoteUsable: true, requiresLogin: false, status: "ok" },
    },
    logs: [],
    rankingCapabilities: {
      entries: {
        "week-1": { status: "available", url: "https://hsl.example/weeks/week-1", weekId: "week-1" },
      },
      webBaseUrl: "https://hsl.example",
    },
    rankingOpening: false,
  };
  return {
    ...base,
    ...overrides,
    data: { ...base.data, ...(overrides.data || {}) },
  };
}

test("connectivity presentation distinguishes the complete product matrix", async () => {
  const { deriveConnectivityPresentation } = await presentationApi();
  const configured = { status: "configured" };
  const cases = [
    [{ reachability: "unknown", displayStatus: "unknown", probe: { inFlight: false } }, "unknown"],
    [{ reachability: "unknown", displayStatus: "connecting", probe: { inFlight: true, phase: "startup" } }, "checking"],
    [{ reachability: "connected", displayStatus: "connected", probe: { inFlight: false } }, "connected"],
    [{ reachability: "offline", displayStatus: "reconnecting", probe: { inFlight: true, phase: "retry" } }, "reconnecting"],
    [{ reachability: "offline", displayStatus: "offline", probe: { inFlight: false } }, "offline"],
    [{ reachability: "connected", displayStatus: "connected", activity: "suspended", probe: { inFlight: false } }, "suspended"],
    [{ reachability: "unknown", displayStatus: "unknown", reason: "timeout", probe: { inFlight: false } }, "probe-error"],
  ];
  for (const [connectivity, expected] of cases) {
    assert.equal(deriveConnectivityPresentation(connectivity, configured).status, expected);
  }
  assert.equal(deriveConnectivityPresentation({ reachability: "unknown" }, { status: "missing" }).status, "missing");
  assert.equal(deriveConnectivityPresentation({ reachability: "offline" }, { status: "invalid" }).status, "invalid");
});

test("only confirmed authority produces Connected and silent probes do not flicker", async () => {
  const { deriveConnectivityPresentation } = await presentationApi();
  const configured = { status: "configured" };
  const unconfirmed = deriveConnectivityPresentation({ displayStatus: "connected", reachability: "unknown" }, configured);
  const confirmed = deriveConnectivityPresentation({ displayStatus: "connected", reachability: "connected" }, configured);
  const silent = deriveConnectivityPresentation({
    displayStatus: "connected",
    reachability: "connected",
    probe: { inFlight: true, phase: "background" },
  }, configured);
  assert.equal(unconfirmed.confirmed, false);
  assert.notEqual(unconfirmed.title, "Conectado");
  assert.equal(confirmed.confirmed, true);
  assert.equal(silent.status, "connected");
  assert.equal(silent.silent, true);
});

test("session states silence non-actionable local recovery and preserve actionable accounts", async () => {
  const { deriveSessionPresentation } = await presentationApi();
  const deferred = deriveSessionPresentation({ hasSession: true, requiresLogin: false, status: "deferred" });
  assert.equal(deferred.status, "active");
  assert.equal(deferred.actionRequired, false);
  assert.equal(deferred.recoveryPending, true);
  assert.equal(deferred.technicalStatus, "deferred");
  assert.equal(deriveSessionPresentation({ hasSession: true, requiresLogin: true }).status, "requires-login");
  assert.equal(deriveSessionPresentation({ hasSession: true, requiresLogin: true }).actionRequired, true);
  assert.equal(deriveSessionPresentation({ hasSession: false }, { knownAccounts: [] }).status, "no-session");
  assert.equal(deriveSessionPresentation({ hasSession: false }, { knownAccounts: [{ userId: "remembered" }] }).status, "remembered-without-session");
  assert.equal(deriveSessionPresentation({}, {}, { busy: true, busyLabel: "Cambiando cuenta" }).status, "switching");
});

test("membership checking requires a current request and temporary failure is stable", async () => {
  const { deriveMembershipPresentation } = await presentationApi();
  const context = { accountId: "user-1", instanceKey: "pack-1", weekId: "week-1" };
  const checking = {
    generation: 8,
    request: { accountId: "user-1", contextCurrent: true, generation: 8, inFlight: true, instanceKey: "pack-1", weekId: "week-1" },
    status: "checking",
  };
  assert.equal(deriveMembershipPresentation({}, { hasSession: true }).status, "unknown");
  assert.equal(deriveMembershipPresentation({ status: "checking" }, { hasSession: true }, context).status, "unknown");
  assert.equal(deriveMembershipPresentation(checking, { hasSession: true, userId: "user-1" }, context).status, "checking");
  assert.equal(deriveMembershipPresentation({ ...checking, generation: 9 }, { hasSession: true, userId: "user-1" }, context).status, "unknown");
  const notMember = deriveMembershipPresentation({ status: "not_member", joinUrl: "https://hsl.example" }, { hasSession: true });
  assert.equal(notMember.status, "not_member");
  assert.equal(notMember.primaryAction.action, "open-membership-url");
  assert.equal(deriveMembershipPresentation({ status: "error" }, { hasSession: true }).status, "error");
  assert.equal(deriveMembershipPresentation({ status: "unknown", checkedAt: "2026-07-27" }, { hasSession: true }).title, "No se pudo consultar la participación");
  assert.equal(deriveMembershipPresentation({ status: "unknown", authDeferred: true }, { hasSession: true }).status, "deferred");
  assert.equal(deriveMembershipPresentation({ status: "no_session" }, { hasSession: false }).status, "no_session");
});

test("pack presentation prioritizes duplicate, keeps legacy as warning and separates practice-only", async () => {
  const { derivePackPresentation } = await presentationApi();
  const ready = { canPlayCompetition: true, canPractice: true, checks: [], status: "ready" };
  assert.equal(derivePackPresentation({ game: { duplicateGroup: true }, readiness: ready }).status, "duplicate");
  const legacy = derivePackPresentation({ game: {}, readiness: ready, bridge: { deprecated: true } });
  assert.equal(legacy.status, "legacy");
  assert.equal(legacy.severity, "warning");
  assert.equal(derivePackPresentation({ game: {}, readiness: { ...ready, canPlayCompetition: false } }).status, "practice-only");
  assert.equal(derivePackPresentation({ game: {}, readiness: { ...ready, canPractice: false } }).severity, "blocked");
});

test("queue copy distinguishes pending, deferral, failure and success while stating local safety", async () => {
  const { deriveQueuePresentation } = await presentationApi();
  const session = { hasSession: true };
  const pendingQueue = { totals: { failed: 0, pending: 2, sent: 0 } };
  const pending = deriveQueuePresentation(pendingQueue, { status: "idle" }, session);
  const deferred = deriveQueuePresentation(pendingQueue, { status: "blocked", reason: "no_session" }, session);
  const failed = deriveQueuePresentation({ totals: { failed: 1, pending: 0, sent: 0 } }, { status: "partial_failed" }, session);
  const synced = deriveQueuePresentation({ totals: { failed: 0, pending: 0, sent: 1 } }, { status: "synced", sentCount: 1 }, session);
  assert.equal(pending.status, "pending");
  assert.match(pending.description, /guardad[ao]s? localmente|guardadas localmente/);
  assert.equal(deferred.status, "deferred");
  assert.match(deferred.description, /Se enviarán/);
  assert.equal(failed.status, "failed");
  assert.match(failed.description, /Siguen guardadas localmente/);
  assert.equal(synced.status, "synced");
  assert.match(synced.description, /enviado 1 puntuación/);
});

test("ranking distinguishes missing week, offline, checking, unpublished, error and opening", async () => {
  const { deriveRankingPresentation } = await presentationApi();
  assert.equal(deriveRankingPresentation(state(), {}).status, "missing-week");
  const offline = state({ connectivity: { reachability: "offline", displayStatus: "offline" } });
  assert.equal(deriveRankingPresentation(offline, offline.data.game).status, "offline");
  const checking = state({ rankingCapabilities: { entries: {}, webBaseUrl: "https://hsl.example" } });
  assert.equal(deriveRankingPresentation(checking, checking.data.game).status, "checking");
  const unpublished = state({ rankingCapabilities: { entries: { "week-1": { status: "unavailable", weekId: "week-1" } }, webBaseUrl: "https://hsl.example" } });
  assert.equal(deriveRankingPresentation(unpublished, unpublished.data.game).status, "not-published");
  const unknown = state({ rankingCapabilities: { entries: { "week-1": { status: "unknown", weekId: "week-1" } }, webBaseUrl: "https://hsl.example" } });
  assert.equal(deriveRankingPresentation(unknown, unknown.data.game).status, "error");
  assert.equal(deriveRankingPresentation(state({ rankingOpening: true }), state().data.game).status, "opening");
});

test("primary actions use deterministic competition precedence and preserve practice", async () => {
  const { derivePrimaryActions } = await presentationApi();
  const busy = derivePrimaryActions(state({ busy: true, busyLabel: "Actualizando" }));
  assert.equal(busy.competition.reason, "Actualizando");
  assert.equal(busy.competition.label, "Jugar");
  const duplicate = state({
    data: {
      game: { ...state().data.game, duplicateGroup: true },
      session: { hasSession: false, requiresLogin: false },
      readiness: { ...state().data.readiness, canPlayCompetition: false, canPractice: false },
    },
  });
  assert.match(derivePrimaryActions(duplicate).competition.reason, /varios packs/);
  const noSession = state({ data: { session: { hasSession: false, requiresLogin: false }, readiness: { ...state().data.readiness, canPlayCompetition: false } } });
  const noSessionActions = derivePrimaryActions(noSession);
  assert.match(noSessionActions.competition.reason, /Inicia sesión/);
  assert.equal(noSessionActions.practice.available, true);
  const requiresLogin = state({ data: { session: { hasSession: true, requiresLogin: true }, readiness: { ...state().data.readiness, canPlayCompetition: false } } });
  assert.match(derivePrimaryActions(requiresLogin).competition.reason, /Vuelve a iniciar sesión/);
  const membership = state({ data: { membership: { canPlayCompetition: false, status: "not_member" }, readiness: { ...state().data.readiness, canPlayCompetition: false } } });
  assert.match(derivePrimaryActions(membership).competition.reason, /Únete desde la web/);

  const checking = state({
    data: {
      accounts: { activeUserId: "user-1", knownAccounts: [{ isActive: true, userId: "user-1" }] },
      game: { ...state().data.game, instanceKey: "pack-1" },
      membership: {
        canPlayCompetition: false,
        generation: 2,
        resolution: { active: true, accountId: "user-1", contextCurrent: true, generation: 2, instanceKey: "pack-1", weekId: "week-1" },
        status: "checking",
      },
      readiness: { ...state().data.readiness, canPlayCompetition: false },
      session: { ...state().data.session, userId: "user-1" },
    },
  });
  const checkingActions = derivePrimaryActions(checking);
  assert.equal(checkingActions.competition.available, false);
  assert.equal(checkingActions.competition.reason, "Comprobando participación");
});

test("primary actions consumen la proyeccion competitiva para semanas y no convierten membership 401 en login", async () => {
  const { deriveMembershipPresentation, derivePrimaryActions } = await presentationApi();
  const closed = state({
    data: {
      competitionAccess: { canPlayCompetition: false, canPractice: true, reason: "week-closed" },
      readiness: { ...state().data.readiness, canPlayCompetition: false },
      weekCapability: { publicState: "closed" },
    },
  });
  const actions = derivePrimaryActions(closed);
  assert.equal(actions.competition.available, false);
  assert.match(actions.competition.reason, /cerrada/);
  assert.equal(actions.practice.available, true);

  const rejectedConsumer = deriveMembershipPresentation(
    { status: "unauthenticated" },
    { hasSession: true, requiresLogin: false },
  );
  assert.notEqual(rejectedConsumer.status, "requires-login");
  assert.doesNotMatch(rejectedConsumer.title, /iniciar sesiÃ³n/i);
});

test("confirmed member plus ready pack uses the exact Pack listo success summary", async () => {
  const { deriveGameSummaryPresentation } = await presentationApi();
  const summary = deriveGameSummaryPresentation(state());
  assert.equal(summary.title, "Pack listo");
  assert.equal(summary.severity, "success");
  assert.notEqual(summary.title, "Listo para competir");
});

test("a ready pack without a session keeps the membership action visible", async () => {
  const { deriveGameSummaryPresentation } = await presentationApi();
  const summary = deriveGameSummaryPresentation(state({
    data: {
      membership: { status: "no_session" },
      session: { hasSession: false, remoteUsable: false, requiresLogin: false, status: "no_session" },
    },
  }));
  assert.equal(summary.title, "Inicia sesión para competir");
  assert.notEqual(summary.title, "Pack listo");
});

test("manual and ranking expose reasons and actions re-enable after busy", async () => {
  const { derivePrimaryActions } = await presentationApi();
  const unavailable = state({ data: { game: { ...state().data.game, manual: { available: false } } } });
  assert.match(derivePrimaryActions(unavailable).manual.reason, /no incluye un manual/);
  const busy = derivePrimaryActions(state({ busy: true, busyLabel: "Procesando" }));
  assert.equal(busy.ranking.available, false);
  const ready = derivePrimaryActions(state());
  assert.equal(ready.ranking.available, true);
  assert.equal(ready.competition.available, true);
});

test("presentation derivation is pure and creates no second authority", async () => {
  const api = await presentationApi();
  const snapshot = state();
  const before = JSON.stringify(snapshot);
  const result = api.deriveLauncherPresentation(snapshot);
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(result.connectivity.confirmed, true);
  assert.equal("launcherStateRevision" in result, false);
});

test("live announcements are focused and ignore silent probes", async () => {
  const { deriveLiveAnnouncement } = await presentationApi();
  const previous = state();
  const silent = state({
    connectivity: {
      displayStatus: "connected",
      probe: { inFlight: true, phase: "background" },
      reachability: "connected",
    },
  });
  assert.equal(deriveLiveAnnouncement(previous, silent, ["connectivity"]), null);
  const unresolved = state({ connectivity: { displayStatus: "connecting", probe: { inFlight: true, phase: "startup" }, reachability: "unknown" } });
  assert.equal(deriveLiveAnnouncement(state({ connectivity: null }), unresolved, ["connectivity"]), null);
  const offline = state({ connectivity: { displayStatus: "offline", probe: { inFlight: false }, reachability: "offline" } });
  assert.equal(deriveLiveAnnouncement(previous, offline, ["connectivity"]), "Desconectado");
  const manual = state({ busy: true, busyLabel: "Comprobando conexión", connectivity: offline.connectivity });
  assert.equal(deriveLiveAnnouncement(previous, manual, ["connectivity"]), null);
  const logState = state({ logs: [{ summary: "Puntuación enviada" }] });
  assert.equal(deriveLiveAnnouncement(previous, logState, ["logs"]), "Puntuación enviada");
});

test("normal account switches stay silent while actionable outcomes remain visible", async () => {
  const { shouldSurfaceAccountSwitchResult } = await presentationApi();

  assert.equal(shouldSurfaceAccountSwitchResult({ action: "switch-account", ok: true }), false);
  assert.equal(shouldSurfaceAccountSwitchResult({ action: "switch-account", ok: false }), true);
  assert.equal(shouldSurfaceAccountSwitchResult({
    action: "switch-account-login-required",
    ok: false,
    requiresLogin: true,
  }), true);
  assert.equal(shouldSurfaceAccountSwitchResult(null), true);
});
