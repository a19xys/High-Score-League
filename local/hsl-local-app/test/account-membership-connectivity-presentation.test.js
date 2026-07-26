const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

async function presentationApi() {
  return import(pathToFileURL(path.join(rendererRoot, "product-presentation.js")).href);
}

async function headerApi() {
  return import(pathToFileURL(path.join(rendererRoot, "components", "header.js")).href);
}

function productState(overrides = {}) {
  const base = {
    accountMenuOpen: true,
    busy: false,
    connectivity: {
      displayStatus: "connected",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 4,
    },
    data: {
      accounts: {
        activeUserId: "user-1",
        knownAccounts: [{
          email: "active@example.test",
          hasLocalSession: true,
          isActive: true,
          remoteUsable: true,
          requiresLogin: false,
          status: "valid",
          userId: "user-1",
        }],
      },
      autoSync: { status: "idle" },
      bridge: { contractStatus: "current" },
      game: { displayName: "Space Invaders", instanceKey: "pack-1", weekId: "week-1" },
      library: {
        directory: { available: true, configured: true },
        packs: [{ instanceKey: "pack-1" }],
        status: "available-populated",
      },
      membership: {
        canPlayCompetition: true,
        canSubmit: true,
        checkedAt: "2026-07-26T10:00:00.000Z",
        status: "member",
        weekId: "week-1",
      },
      queue: { totals: { failed: 0, pending: 2, sent: 1 } },
      readiness: { blockers: [], canPlayCompetition: true, canPractice: true, checks: [], status: "ready" },
      remoteConfiguration: { status: "configured" },
      selection: { activeInstanceKey: "pack-1" },
      session: {
        email: "active@example.test",
        hasSession: true,
        remoteUsable: true,
        requiresLogin: false,
        status: "ok",
        userId: "user-1",
      },
    },
    logs: [],
    theme: "dark",
  };

  return {
    ...base,
    ...overrides,
    data: {
      ...base.data,
      ...(overrides.data || {}),
    },
  };
}

function checkingMembership(overrides = {}) {
  return {
    canPlayCompetition: true,
    generation: 12,
    request: {
      accountId: "user-1",
      contextCurrent: true,
      generation: 12,
      inFlight: true,
      instanceKey: "pack-1",
      weekId: "week-1",
    },
    status: "checking",
    weekId: "week-1",
    ...overrides,
  };
}

test("stored auto-recoverable sessions produce no account notice or equivalent row warning", async () => {
  const { renderAccountControl } = await headerApi();
  const state = productState({
    data: {
      accounts: {
        activeUserId: "user-1",
        knownAccounts: [{
          email: "active@example.test",
          hasLocalSession: true,
          isActive: true,
          remoteUsable: false,
          requiresLogin: false,
          status: "deferred",
          userId: "user-1",
        }],
      },
      session: {
        email: "active@example.test",
        hasSession: true,
        remoteUsable: false,
        requiresLogin: false,
        status: "deferred",
        userId: "user-1",
      },
    },
  });

  for (const technicalStatus of ["deferred", "temporary-failure", "cancelled", "refreshing"]) {
    const html = renderAccountControl({
      ...state,
      data: {
        ...state.data,
        accounts: {
          activeUserId: "user-1",
          knownAccounts: state.data.accounts.knownAccounts.map((account) => ({ ...account, status: technicalStatus })),
        },
        session: { ...state.data.session, status: technicalStatus },
      },
    });
    assert.doesNotMatch(html, /Cuenta cambiada|Sesión conservada|Se conservó tu sesión/);
    assert.doesNotMatch(html, /account-session-state|account-row__session-warning/);
    assert.match(html, /aria-current="true"/);
    assert.match(html, /active@example\.test/);
  }
});

test("reopening and irrelevant snapshots cannot recreate the non-actionable account notice", async () => {
  const { renderAccountControl } = await headerApi();
  const deferred = productState({
    data: { session: { ...productState().data.session, remoteUsable: false, status: "deferred" } },
  });
  const reopened = renderAccountControl(deferred);
  const later = renderAccountControl({
    ...deferred,
    data: { ...deferred.data, timestamp: "2026-07-26T10:01:00.000Z" },
  });

  assert.equal(reopened.includes("account-session-state"), false);
  assert.equal(later.includes("account-session-state"), false);
});

test("login-required, revoked and terminal session failures remain visible", async () => {
  const { renderAccountControl } = await headerApi();
  for (const status of ["revoked", "corrupt", "provider-mismatch"]) {
    const state = productState({
      data: {
        session: { ...productState().data.session, requiresLogin: true, status },
      },
    });
    const html = renderAccountControl(state);
    assert.match(html, /account-session-state/);
    assert.match(html, /Vuelve a iniciar sesión/);
  }

  const errorState = productState({
    data: { session: { hasSession: true, requiresLogin: false, status: "error", userId: "user-1" } },
  });
  assert.match(renderAccountControl(errorState), /No se pudo leer la sesión/);
});

test("account silence is presentation-only and leaves session, queue and logs untouched", async () => {
  const { deriveSessionPresentation, shouldSurfaceAccountSwitchResult } = await presentationApi();
  const state = productState({ data: { session: { ...productState().data.session, status: "deferred" } } });
  const before = structuredClone(state);

  const presentation = deriveSessionPresentation(state.data.session, state.data.accounts, state);

  assert.equal(presentation.status, "active");
  assert.equal(shouldSurfaceAccountSwitchResult({ action: "switch-account", ok: true }), false);
  assert.equal(shouldSurfaceAccountSwitchResult({ action: "switch-account", ok: false }), true);
  assert.deepEqual(state, before);
});

test("session-only changes never announce preserved-session copy", async () => {
  const { deriveLiveAnnouncement } = await presentationApi();
  const previous = productState();
  const deferred = productState({
    data: { session: { ...previous.data.session, remoteUsable: false, status: "deferred" } },
  });

  assert.equal(deriveLiveAnnouncement(previous, deferred, ["data"]), null);
  assert.equal(deriveLiveAnnouncement(previous, deferred, ["session"]), null);
});

test("checking requires a live request for the exact account, pack, week and generation", async () => {
  const { deriveMembershipPresentation } = await presentationApi();
  const context = { accountId: "user-1", instanceKey: "pack-1", weekId: "week-1" };
  const session = { hasSession: true, userId: "user-1" };

  assert.equal(deriveMembershipPresentation(checkingMembership(), session, context).status, "checking");
  assert.equal(deriveMembershipPresentation(checkingMembership({ request: { ...checkingMembership().request, inFlight: false } }), session, context).status, "unknown");
  assert.equal(deriveMembershipPresentation(checkingMembership({ request: { ...checkingMembership().request, accountId: "user-2" } }), session, context).status, "unknown");
  assert.equal(deriveMembershipPresentation(checkingMembership({ request: { ...checkingMembership().request, instanceKey: "pack-2" } }), session, context).status, "unknown");
  assert.equal(deriveMembershipPresentation(checkingMembership({ request: { ...checkingMembership().request, weekId: "week-2" } }), session, context).status, "unknown");
  assert.equal(deriveMembershipPresentation(checkingMembership({ generation: 13 }), session, context).status, "unknown");
  assert.equal(deriveMembershipPresentation({ status: "unknown", technicalReason: "deferred" }, session, context).status, "unknown");
});

test("background membership refresh preserves a stable result only in the same context", async () => {
  const { selectMembershipForPresentation, shouldPreserveMembershipPresentation } = await presentationApi();
  const previousMember = productState();
  const previousNotMember = productState({
    data: { membership: { canPlayCompetition: false, checkedAt: "2026-07-26T10:00:00.000Z", status: "not_member", weekId: "week-1" } },
  });
  const deferred = productState({
    data: { membership: { canPlayCompetition: true, checkedAt: null, status: "unknown", technicalReason: "deferred", weekId: "week-1" } },
  });
  const checking = productState({ data: { membership: checkingMembership() } });

  assert.equal(selectMembershipForPresentation(deferred, previousMember).status, "member");
  assert.equal(selectMembershipForPresentation(checking, previousNotMember).status, "not_member");
  assert.equal(shouldPreserveMembershipPresentation(deferred, previousMember), true);
  assert.equal(shouldPreserveMembershipPresentation(deferred, deferred), true);
  assert.equal(shouldPreserveMembershipPresentation(checking, previousNotMember), true);

  const otherAccount = productState({
    data: {
      accounts: { activeUserId: "user-2", knownAccounts: [{ isActive: true, userId: "user-2" }] },
      membership: deferred.data.membership,
      session: { ...productState().data.session, userId: "user-2" },
    },
  });
  const otherPack = productState({
    data: {
      game: { ...productState().data.game, instanceKey: "pack-2" },
      membership: deferred.data.membership,
      selection: { activeInstanceKey: "pack-2" },
    },
  });
  const otherWeek = productState({
    data: {
      game: { ...productState().data.game, weekId: "week-2" },
      membership: { ...deferred.data.membership, weekId: "week-2" },
    },
  });

  assert.equal(selectMembershipForPresentation(otherAccount, previousMember).status, "unknown");
  assert.equal(selectMembershipForPresentation(otherPack, previousMember).status, "unknown");
  assert.equal(selectMembershipForPresentation(otherWeek, previousMember).status, "unknown");
  assert.equal(shouldPreserveMembershipPresentation(otherAccount, previousMember), false);
  assert.equal(shouldPreserveMembershipPresentation(otherPack, previousMember), false);
  assert.equal(shouldPreserveMembershipPresentation(otherWeek, previousMember), false);
});

test("stable membership outcomes replace checking and remain retryable through existing actions", async () => {
  const { deriveMembershipPresentation, deriveSupportingActions, selectMembershipForPresentation } = await presentationApi();
  const previous = productState({ data: { membership: checkingMembership() } });
  const cases = [
    ["member", "member"],
    ["not_member", "not_member"],
    ["error", "error"],
    ["unknown", "unknown"],
    ["unauthenticated", "requires-login"],
  ];

  for (const [technical, visible] of cases) {
    const next = productState({
      data: {
        membership: {
          canPlayCompetition: technical !== "not_member",
          checkedAt: "2026-07-26T10:00:01.000Z",
          remoteFailure: technical === "unknown" ? "timeout" : null,
          status: technical,
          weekId: "week-1",
        },
      },
    });
    assert.equal(deriveMembershipPresentation(next.data.membership, next.data.session, {
      accountId: "user-1",
      instanceKey: "pack-1",
      weekId: "week-1",
    }).status, visible);
    assert.equal(selectMembershipForPresentation(next, previous).status, technical);
  }

  assert.equal(deriveSupportingActions(productState()).checkMembership.available, true);
});

test("public connectivity projection is binary across every internal state", async () => {
  const { derivePublicConnectivityPresentation } = await presentationApi();
  const cases = [
    [null, "disconnected"],
    [{ reachability: "unknown", displayStatus: "connecting", probe: { inFlight: true, phase: "startup" } }, "disconnected"],
    [{ reachability: "offline", displayStatus: "reconnecting", probe: { inFlight: true, phase: "retry" } }, "disconnected"],
    [{ reachability: "offline", activity: "suspended", displayStatus: "offline" }, "disconnected"],
    [{ reachability: "unknown", reason: "timeout" }, "disconnected"],
    [{ reachability: "connected", displayStatus: "reconnecting", probe: { inFlight: true, phase: "manual" } }, "connected"],
    [{ reachability: "connected", activity: "suspended" }, "connected"],
  ];

  for (const [connectivity, expected] of cases) {
    const result = derivePublicConnectivityPresentation(connectivity);
    assert.equal(result.status, expected);
    assert.ok(["Conectado", "Desconectado"].includes(result.title));
  }
  assert.equal(derivePublicConnectivityPresentation({ reachability: "connected" }, { status: "missing" }).status, "disconnected");
  assert.equal(derivePublicConnectivityPresentation({ reachability: "connected" }, { status: "invalid" }).status, "disconnected");
});

test("normal connectivity markup uses text and a decorative CSS dot without SVG", async () => {
  const { renderConnectionControl } = await headerApi();
  const connected = renderConnectionControl(productState());
  const disconnected = renderConnectionControl(productState({
    connectivity: { displayStatus: "reconnecting", probe: { inFlight: true, phase: "retry" }, reachability: "offline" },
    data: { remoteConfiguration: { status: "invalid" } },
  }));

  assert.match(connected, /connection-chip--connected/);
  assert.match(connected, /<span class="connection-dot" aria-hidden="true"><\/span>/);
  assert.match(connected, />Conectado</);
  assert.match(disconnected, /connection-chip--disconnected/);
  assert.match(disconnected, />Desconectado</);
  assert.doesNotMatch(`${connected}${disconnected}`, /renderIcon|ui-icon|\.svg|<img|<svg|refresh|check|cross/i);
});

test("probes keep identical header HTML and live output until committed reachability changes", async () => {
  const [{ renderConnectionControl }, { deriveLiveAnnouncement }] = await Promise.all([headerApi(), presentationApi()]);
  const connected = productState();
  const connectedProbe = productState({
    connectivity: { displayStatus: "reconnecting", probe: { inFlight: true, phase: "background" }, reachability: "connected" },
  });
  const offline = productState({
    connectivity: { displayStatus: "offline", probe: { inFlight: false, phase: "idle" }, reachability: "offline" },
  });
  const offlineProbe = productState({
    connectivity: { displayStatus: "reconnecting", probe: { inFlight: true, phase: "retry" }, reachability: "offline" },
  });

  assert.equal(renderConnectionControl(connected), renderConnectionControl(connectedProbe));
  assert.equal(renderConnectionControl(offline), renderConnectionControl(offlineProbe));
  assert.equal(deriveLiveAnnouncement(connected, connectedProbe, ["connectivity"]), null);
  assert.equal(deriveLiveAnnouncement(offline, offlineProbe, ["connectivity"]), null);
  assert.equal(deriveLiveAnnouncement(connected, offline, ["connectivity"]), "Desconectado");
  assert.equal(deriveLiveAnnouncement(offline, connected, ["connectivity"]), "Conectado");
});

test("binary header does not replace detailed remote gates or create network authority", async () => {
  const { deriveSupportingActions } = await presentationApi();
  const offline = productState({
    connectivity: { displayStatus: "offline", probe: { inFlight: false }, reachability: "offline" },
  });
  const invalidConfiguration = productState({ data: { remoteConfiguration: { status: "invalid" } } });
  const [app, productPresentation] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "product-presentation.js"), "utf8"),
  ]);

  assert.equal(deriveSupportingActions(offline).checkMembership.available, false);
  assert.equal(deriveSupportingActions(invalidConfiguration).login.available, false);
  assert.doesNotMatch(productPresentation, /navigator\.onLine/);
  assert.doesNotMatch(app, /navigator\.onLine/);
});
