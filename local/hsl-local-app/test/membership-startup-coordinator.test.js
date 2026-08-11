const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createMembershipStartupCoordinator,
  membershipExecutionKey,
  membershipResolutionContext,
} = require("../src/membership-startup-coordinator");

function launcherState(overrides = {}) {
  const base = {
    accounts: {
      activeUserId: "account-a",
      knownAccounts: [{ isActive: true, userId: "account-a" }],
    },
    autoSync: { status: "blocked" },
    game: { instanceKey: "pack-a", weekId: "week-a" },
    membership: {
      canPlayCompetition: true,
      canSubmit: false,
      checkedAt: null,
      status: "unknown",
      technicalReason: "deferred",
      weekId: "week-a",
    },
    readiness: {
      blockers: [],
      canPlayCompetition: true,
      canPractice: true,
      checks: [{ id: "membership", level: "warning", message: "No se pudo comprobar." }],
      status: "warning",
      warnings: ["No se pudo comprobar."],
    },
    remoteConfiguration: { status: "configured" },
    selection: { activeInstanceKey: "pack-a" },
    session: {
      hasSession: true,
      requiresLogin: false,
      sessionRevision: 3,
      userId: "account-a",
    },
  };
  return {
    ...base,
    ...overrides,
    accounts: { ...base.accounts, ...(overrides.accounts || {}) },
    game: overrides.game === null ? null : { ...base.game, ...(overrides.game || {}) },
    membership: { ...base.membership, ...(overrides.membership || {}) },
    readiness: { ...base.readiness, ...(overrides.readiness || {}) },
    remoteConfiguration: { ...base.remoteConfiguration, ...(overrides.remoteConfiguration || {}) },
    selection: { ...base.selection, ...(overrides.selection || {}) },
    session: { ...base.session, ...(overrides.session || {}) },
  };
}

function finalState(status = "member", overrides = {}) {
  const canPlayCompetition = status === "member" || ["error", "unknown"].includes(status);
  return launcherState({
    ...overrides,
    membership: {
      canPlayCompetition,
      canSubmit: status === "member",
      checkedAt: "2026-07-27T10:00:00.000Z",
      status,
      technicalReason: status === "member" ? "HTTP 200 - member" : status,
      ...(overrides.membership || {}),
    },
    readiness: {
      blockers: canPlayCompetition ? [] : ["Membership bloqueada."],
      canPlayCompetition,
      canPractice: true,
      checks: [{ id: "membership", level: status === "member" ? "ok" : "error", message: status }],
      status: canPlayCompetition ? "ready" : "blocked",
      warnings: [],
      ...(overrides.readiness || {}),
    },
  });
}

function stateForIdentity(accountId, instanceKey, weekId, overrides = {}) {
  return launcherState({
    ...overrides,
    accounts: {
      activeUserId: accountId,
      knownAccounts: [{ isActive: true, userId: accountId }],
      ...(overrides.accounts || {}),
    },
    game: { instanceKey, weekId, ...(overrides.game || {}) },
    membership: { weekId, ...(overrides.membership || {}) },
    selection: { activeInstanceKey: instanceKey, ...(overrides.selection || {}) },
    session: { userId: accountId, ...(overrides.session || {}) },
  });
}

function finalStateForContext(context, status = "member", overrides = {}) {
  return finalState(status, {
    ...overrides,
    accounts: {
      activeUserId: context.accountId,
      knownAccounts: [{ isActive: true, userId: context.accountId }],
      ...(overrides.accounts || {}),
    },
    game: { instanceKey: context.instanceKey, weekId: context.weekId, ...(overrides.game || {}) },
    membership: { weekId: context.weekId, ...(overrides.membership || {}) },
    selection: { activeInstanceKey: context.instanceKey, ...(overrides.selection || {}) },
    session: { userId: context.accountId, ...(overrides.session || {}) },
  });
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function harness({ initialConnection, execute, remoteTimeoutMs = 5000 } = {}) {
  let nowMs = Date.parse("2026-07-27T09:00:00.000Z");
  let revision = 0;
  let timerSequence = 0;
  let connection = initialConnection || {
    activity: "active",
    probe: { inFlight: true, phase: "startup" },
    reachability: "unknown",
    reachabilityGeneration: 0,
  };
  const publications = [];
  const tasks = [];
  const calls = [];
  const timers = new Map();
  const coordinator = createMembershipStartupCoordinator({
    clearTimeout: (timerId) => timers.delete(timerId),
    connectivityTimeoutMs: 3000,
    execute: (context) => {
      calls.push(context);
      return execute ? execute(context, calls.length) : finalState("member");
    },
    getConnectivityState: () => connection,
    now: () => nowMs,
    publish: (state, meta) => publications.push({ meta, state }),
    queueTask: (task) => tasks.push(task),
    remoteTimeoutMs,
    reserveRevision: () => ++revision,
    setTimeout: (callback, delayMs) => {
      const timerId = ++timerSequence;
      timers.set(timerId, { callback, dueAt: nowMs + Math.max(0, Number(delayMs) || 0) });
      return timerId;
    },
  });
  return {
    advanceBy(delayMs) {
      const target = nowMs + delayMs;
      while (true) {
        const pending = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0]);
        if (pending.length === 0) break;
        const [timerId, timer] = pending[0];
        timers.delete(timerId);
        nowMs = timer.dueAt;
        timer.callback();
      }
      nowMs = target;
    },
    calls,
    coordinator,
    flushTask() {
      const task = tasks.shift();
      task?.();
    },
    get connection() {
      return connection;
    },
    publications,
    reserveExternalRevision() {
      revision += 1;
      return revision;
    },
    setConnection(next) {
      connection = { ...connection, ...next };
    },
    setNow(value) {
      nowMs = value;
    },
    tasks,
    timers,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test("startup deferred creates one bounded pipeline and waits silently for committed connectivity", () => {
  const h = harness();
  const checking = h.coordinator.observeState(launcherState(), "initial-state");

  assert.equal(checking.membership.status, "checking");
  assert.equal(checking.membership.resolution.stage, "waiting-connectivity");
  assert.equal(checking.membership.request, null);
  assert.equal(checking.membership.canPlayCompetition, false);
  assert.equal(checking.readiness.canPlayCompetition, false);
  assert.match(checking.membership.resolution.deadlineAt, /^2026-07-27T09:00:03\.000Z$/);
  assert.equal(h.calls.length, 0);

  const equivalent = h.coordinator.observeState(launcherState(), "equivalent-snapshot");
  assert.equal(equivalent.membership.generation, checking.membership.generation);
  assert.equal(h.tasks.length, 0);
  h.coordinator.shutdown("test-cleanup");
  assert.equal(h.timers.size, 0);
});

test("connected after startup starts one request and member converges without a pack interaction", async () => {
  const request = deferred();
  const h = harness({ execute: () => request.promise });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.setConnection({
    probe: { inFlight: false, phase: "idle" },
    reachability: "connected",
    reachabilityGeneration: 1,
  });
  h.coordinator.updateConnectivity(h.connection, "connectivity-restored");
  h.flushTask();
  await flushPromises();

  assert.equal(h.calls.length, 1);
  assert.equal(h.publications.length, 1);
  assert.equal(h.publications[0].state.membership.status, "checking");
  assert.equal(h.publications[0].state.membership.request.inFlight, true);
  assert.equal(h.publications[0].state.membership.resolution.stage, "request");
  assert.equal(h.publications[0].state.readiness.canPlayCompetition, false);

  h.coordinator.observeState(launcherState(), "equivalent-while-running");
  h.coordinator.updateConnectivity(h.connection, "equivalent-connectivity");
  h.flushTask();
  assert.equal(h.calls.length, 1);

  request.resolve(finalState("member"));
  await flushPromises();
  assert.equal(h.publications.at(-1).state.membership.status, "member");
  assert.equal(h.publications.at(-1).state.readiness.canPlayCompetition, true);
  assert.equal(h.coordinator.isActive(), false);
});

test("already connected before the local snapshot starts exactly one membership request", async () => {
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 4,
    },
  });
  const checking = h.coordinator.observeState(launcherState(), "initial-state");
  assert.equal(checking.membership.status, "checking");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 1);
  assert.equal(h.publications.at(-1).state.membership.status, "member");
});

test("refreshable session remains inside the same checking pipeline and receives abort authority", async () => {
  const result = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: ({ signal }) => {
      assert.equal(signal.aborted, false);
      return result.promise;
    },
  });
  h.coordinator.observeState(launcherState({ session: { status: "refreshing" } }), "session-refresh");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 1);
  assert.equal(h.publications[0].state.membership.status, "checking");
  result.resolve(finalState("member", { session: { sessionRevision: 4 } }));
  await flushPromises();
  assert.equal(h.publications.at(-1).state.session.sessionRevision, 4);
});

test("missing account, login, week or remote configuration never starts an impossible request", () => {
  const cases = [
    launcherState({ accounts: { activeUserId: null, knownAccounts: [] }, session: { userId: null } }),
    launcherState({ session: { hasSession: false, requiresLogin: true }, membership: { status: "unauthenticated", technicalReason: "auth-required" } }),
    launcherState({ game: { weekId: null }, membership: { status: "missing_week", technicalReason: "missing-week", weekId: null } }),
    launcherState({ remoteConfiguration: { status: "invalid" } }),
  ];
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
  });
  for (const state of cases) assert.notEqual(h.coordinator.observeState(state).membership.status, "checking");
  assert.equal(h.tasks.length, 0);
  assert.equal(h.calls.length, 0);
});

test("offline settles checking, never infers member and a later connected generation can retry", async () => {
  const h = harness();
  h.coordinator.observeState(launcherState(), "initial-state");
  h.setConnection({
    probe: { inFlight: false, phase: "idle" },
    reachability: "offline",
    reachabilityGeneration: 1,
  });
  h.coordinator.updateConnectivity(h.connection, "startup-offline");
  assert.equal(h.publications.at(-1).state.membership.status, "error");
  assert.equal(h.publications.at(-1).state.membership.canSubmit, false);
  assert.equal(h.coordinator.isActive(), false);

  h.setConnection({ reachability: "connected", reachabilityGeneration: 2 });
  h.coordinator.updateConnectivity(h.connection, "connectivity-restored");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 1);
  assert.equal(h.publications.at(-1).state.membership.status, "member");
});

test("timeout, HTTP error and non-JSON outcomes leave checking as stable non-member-positive states", async () => {
  for (const membership of [
    { status: "unknown", remoteFailure: "timeout", technicalReason: "timeout:deadline-exceeded" },
    { status: "error", response: { httpStatus: 500 }, technicalReason: "HTTP 500" },
    { status: "error", response: { bodyStatus: "non_json_response", httpStatus: 502 }, technicalReason: "non_json_response" },
  ]) {
    const h = harness({
      initialConnection: {
        activity: "active",
        probe: { inFlight: false, phase: "idle" },
        reachability: "connected",
        reachabilityGeneration: 1,
      },
      execute: () => finalState(membership.status, { membership }),
    });
    h.coordinator.observeState(launcherState(), "initial-state");
    h.flushTask();
    await flushPromises();
    const final = h.publications.at(-1).state.membership;
    assert.notEqual(final.status, "checking");
    assert.notEqual(final.status, "member");
    assert.equal(final.canSubmit, false);
    assert.equal(h.coordinator.isActive(), false);
  }
});

test("account, pack and week changes abort the run and late responses cannot publish", async () => {
  for (const changed of [
    launcherState({ accounts: { activeUserId: "account-b", knownAccounts: [{ isActive: true, userId: "account-b" }] }, session: { userId: "account-b" } }),
    launcherState({ game: { instanceKey: "pack-b" }, selection: { activeInstanceKey: "pack-b" } }),
    launcherState({ game: { weekId: "week-b" }, membership: { weekId: "week-b" } }),
  ]) {
    const request = deferred();
    const h = harness({
      initialConnection: {
        activity: "active",
        probe: { inFlight: false, phase: "idle" },
        reachability: "connected",
        reachabilityGeneration: 1,
      },
      execute: () => request.promise,
    });
    h.coordinator.observeState(launcherState(), "initial-state");
    h.flushTask();
    await flushPromises();
    const signal = h.calls[0].signal;
    h.coordinator.observeState(changed, "identity-change");
    assert.equal(signal.aborted, true);
    const publicationsBeforeLateResult = h.publications.length;
    request.resolve(finalState("member"));
    await flushPromises();
    assert.equal(h.publications.length, publicationsBeforeLateResult);
    assert.equal(h.coordinator.isActive(), true);
    h.coordinator.shutdown("test-cleanup");
  }
});

test("suspend removes checking, resume permits one fresh bounded run, and shutdown cleans it", async () => {
  const first = deferred();
  const second = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: (_context, count) => count === 1 ? first.promise : second.promise,
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  const firstSignal = h.calls[0].signal;
  h.setConnection({ activity: "suspended" });
  h.coordinator.updateConnectivity(h.connection, "suspend");
  assert.equal(firstSignal.aborted, true);
  assert.equal(h.publications.at(-1).state.membership.status, "error");
  assert.equal(h.coordinator.isActive(), false);

  h.setConnection({ activity: "active" });
  h.coordinator.resume("resume");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 2);
  const secondSignal = h.calls[1].signal;
  h.coordinator.shutdown("shutdown");
  assert.equal(secondSignal.aborted, true);
  assert.equal(h.coordinator.getDiagnostics().active, false);
  assert.equal(h.coordinator.getDiagnostics().attempted, 0);
  second.resolve(finalState("member"));
  await flushPromises();
});

test("an invalid result identity settles from the current snapshot and never publishes the foreign state", async () => {
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => finalState("member", {
      game: { instanceKey: "pack-stale" },
      selection: { activeInstanceKey: "pack-stale" },
    }),
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  assert.equal(h.publications.length, 2);
  assert.equal(h.publications.at(-1).state.membership.status, "error");
  assert.equal(h.publications.at(-1).state.game.instanceKey, "pack-a");
  assert.equal(h.publications.at(-1).state.selection.activeInstanceKey, "pack-a");
  assert.equal(h.coordinator.getCurrentState().membership.status, "error");
  assert.equal(h.coordinator.isActive(), false);
});

test("identities include account, pack, week and committed connectivity generation without sharing state", () => {
  const contextA = membershipResolutionContext(launcherState());
  const contextB = membershipResolutionContext(launcherState({
    accounts: { activeUserId: "account-b" },
    game: { instanceKey: "pack-b", weekId: "week-b" },
    selection: { activeInstanceKey: "pack-b" },
    session: { userId: "account-b" },
  }));
  assert.notEqual(contextA.key, contextB.key);
  assert.notEqual(
    membershipExecutionKey(contextA, { reachabilityGeneration: 1 }),
    membershipExecutionKey(contextA, { reachabilityGeneration: 2 }),
  );
});

test("completed A -> B -> A restores the bounded membership cache instead of leaving A deferred", async () => {
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: ({ context }) => finalStateForContext(context),
  });
  const stateA = stateForIdentity("account-a", "pack-a", "week-a");
  const stateB = stateForIdentity("account-b", "pack-b", "week-b");

  h.coordinator.observeState(stateA, "account-a");
  h.flushTask();
  await flushPromises();
  h.coordinator.invalidate("switch-account");
  h.coordinator.observeState(stateB, "account-b");
  h.flushTask();
  await flushPromises();

  h.coordinator.invalidate("switch-account");
  const restoredA = h.coordinator.observeState(stateA, "return-account-a");
  assert.equal(restoredA.membership.status, "member");
  assert.equal(restoredA.membership.request, null);
  assert.equal(restoredA.membership.resolution, null);
  assert.equal(h.calls.length, 2);
  assert.equal(h.tasks.length, 0);
  assert.equal(h.coordinator.getDiagnostics().terminals, 2);
  assert.equal(h.timers.size, 0);
});

test("aborted A -> B -> A forgets attempts and starts a fresh A request", async () => {
  const requests = [];
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: ({ context, signal }) => {
      const request = deferred();
      requests.push({ context, request, signal });
      return request.promise;
    },
  });
  const stateA = stateForIdentity("account-a", "pack-a", "week-a");
  const stateB = stateForIdentity("account-b", "pack-b", "week-b");

  h.coordinator.observeState(stateA, "account-a");
  h.flushTask();
  await flushPromises();
  h.coordinator.observeState(stateB, "account-b");
  h.flushTask();
  await flushPromises();
  h.coordinator.observeState(stateA, "return-account-a");
  h.flushTask();
  await flushPromises();

  assert.deepEqual(h.calls.map((call) => call.context.key), [
    "account-a|pack-a|week-a",
    "account-b|pack-b|week-b",
    "account-a|pack-a|week-a",
  ]);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests[2].signal.aborted, false);
  const publicationsBeforeLateResults = h.publications.length;
  requests[0].request.resolve(finalStateForContext(requests[0].context));
  requests[1].request.resolve(finalStateForContext(requests[1].context));
  await flushPromises();
  assert.equal(h.publications.length, publicationsBeforeLateResults);

  requests[2].request.resolve(finalStateForContext(requests[2].context));
  await flushPromises();
  assert.equal(h.coordinator.getCurrentState().membership.status, "member");
  assert.equal(h.coordinator.isActive(), false);
  assert.equal(h.timers.size, 0);
});

test("connectivity deadline is operational, settles checking and leaves no timer", () => {
  const h = harness();
  h.coordinator.observeState(launcherState(), "initial-state");
  assert.equal(h.coordinator.isActive(), true);
  assert.equal(h.timers.size, 1);

  h.advanceBy(2999);
  assert.equal(h.coordinator.getCurrentState().membership.status, "checking");
  assert.equal(h.coordinator.isActive(), true);
  h.advanceBy(1);

  assert.equal(h.calls.length, 0);
  assert.equal(h.coordinator.isActive(), false);
  assert.equal(h.coordinator.getCurrentState().membership.status, "error");
  assert.equal(h.coordinator.getCurrentState().membership.remoteFailure, "timeout");
  assert.equal(h.publications.at(-1).meta.phase, "settled");
  assert.equal(h.publications.at(-1).state.membership.status, "error");
  assert.equal(h.timers.size, 0);
});

test("remote deadline aborts the request and ignores a late result", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    remoteTimeoutMs: 5000,
    execute: () => request.promise,
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  const signal = h.calls[0].signal;

  h.advanceBy(4999);
  assert.equal(signal.aborted, false);
  assert.equal(h.coordinator.getCurrentState().membership.status, "checking");
  h.advanceBy(1);

  assert.equal(signal.aborted, true);
  assert.equal(h.coordinator.isActive(), false);
  assert.equal(h.coordinator.getCurrentState().membership.remoteFailure, "timeout");
  assert.equal(h.timers.size, 0);
  const publicationsAfterTimeout = h.publications.length;
  request.resolve(finalState("member"));
  await flushPromises();
  assert.equal(h.publications.length, publicationsAfterTimeout);
  assert.equal(h.coordinator.getCurrentState().membership.status, "error");

  h.coordinator.updateConnectivity(h.connection, "same-generation-heartbeat");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 1);
  h.setConnection({ reachabilityGeneration: 2 });
  h.coordinator.updateConnectivity(h.connection, "new-connectivity-generation");
  h.flushTask();
  await flushPromises();
  await flushPromises();
  assert.equal(h.calls.length, 2);
  assert.equal(h.coordinator.getCurrentState().membership.status, "member");
});

test("deadline settles from the stable base when the latest observed snapshot is also checking", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    remoteTimeoutMs: 5000,
    execute: () => request.promise,
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  const checkingEcho = h.coordinator.getCurrentState();
  assert.equal(checkingEcho.readiness.canPlayCompetition, false);
  h.coordinator.observeState(checkingEcho, "checking-echo");

  h.advanceBy(5000);
  const settled = h.coordinator.getCurrentState();
  assert.equal(settled.membership.status, "error");
  assert.equal(settled.readiness.canPlayCompetition, false);
  assert.equal(settled.readiness.status, "warning");
  assert.equal(settled.readiness.title, "Listo con avisos");
  assert.doesNotMatch(settled.readiness.message, /Comprobando participación/);
  assert.equal(settled.readiness.blockers.includes("Comprobando participación."), false);
  assert.equal(settled.readiness.checks.find((item) => item.id === "membership").level, "warning");
  assert.equal(h.timers.size, 0);
});

test("membership results merge into the latest snapshot and terminal restore preserves unrelated state", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => request.promise,
  });
  h.coordinator.observeState(launcherState({
    autoSync: { marker: "old", status: "blocked" },
    queue: { marker: "old" },
  }), "initial-state");
  h.flushTask();
  await flushPromises();

  const latest = launcherState({
    autoSync: { marker: "fresh", status: "partial_failed" },
    queue: { marker: "fresh", totals: { pending: 7 } },
    readiness: {
      blockers: ["Falta ROM."],
      canPlayCompetition: false,
      canPractice: false,
      checks: [
        { id: "rom-file", level: "error", message: "Falta ROM." },
        { id: "membership", level: "warning", message: "No se pudo comprobar." },
      ],
      marker: "fresh-readiness",
      status: "blocked",
      warnings: ["No se pudo comprobar."],
    },
  });
  h.coordinator.observeState(latest, "newer-local-state");
  request.resolve(finalState("member", {
    autoSync: { marker: "stale-result", status: "idle" },
    queue: { marker: "stale-result", totals: { pending: 0 } },
    readiness: { marker: "stale-result" },
  }));
  await flushPromises();

  const merged = h.coordinator.getCurrentState();
  assert.equal(merged.membership.status, "member");
  assert.equal(merged.autoSync.marker, "fresh");
  assert.equal(merged.queue.marker, "fresh");
  assert.equal(merged.readiness.marker, "fresh-readiness");
  assert.equal(merged.readiness.canPractice, false);
  assert.equal(merged.readiness.canPlayCompetition, false);
  assert.equal(merged.readiness.checks.find((item) => item.id === "rom-file").message, "Falta ROM.");
  assert.equal(merged.readiness.checks.find((item) => item.id === "membership").level, "ok");

  const restored = h.coordinator.observeState(launcherState({
    autoSync: { marker: "newest", status: "failed" },
    queue: { marker: "newest", totals: { pending: 9 } },
    readiness: {
      ...latest.readiness,
      marker: "newest-readiness",
    },
  }), "deferred-reload");
  assert.equal(restored.membership.status, "member");
  assert.equal(restored.autoSync.marker, "newest");
  assert.equal(restored.queue.marker, "newest");
  assert.equal(restored.readiness.marker, "newest-readiness");
  assert.equal(restored.readiness.checks.find((item) => item.id === "rom-file").message, "Falta ROM.");
});

test("checking and final revisions are both reserved before execute and late final keeps its old revision", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => request.promise,
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  assert.equal(h.reserveExternalRevision(), 3);
  h.flushTask();
  await flushPromises();
  assert.equal(h.publications[0].meta.revision, 1);

  request.resolve(finalState("member"));
  await flushPromises();
  assert.equal(h.publications.at(-1).meta.revision, 2);
  assert.equal(h.publications.at(-1).state.membership.status, "member");
});

test("an equivalent newer snapshot renews the reserved final revision before that snapshot is returned", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => request.promise,
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  assert.equal(h.publications[0].meta.revision, 1);

  assert.equal(h.reserveExternalRevision(), 3);
  const newer = h.coordinator.observeState(launcherState({
    autoSync: { marker: "newer", status: "blocked" },
  }), "equivalent-newer-snapshot");
  assert.equal(newer.membership.status, "checking");
  request.resolve(finalState("member"));
  await flushPromises();

  assert.equal(h.publications.at(-1).meta.revision, 4);
  assert.equal(h.publications.at(-1).state.autoSync.marker, "newer");
  assert.equal(h.publications.at(-1).state.membership.status, "member");
});

test("a checking push may precede the initial IPC response without losing the complete local startup snapshot", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => request.promise,
  });
  const initialResponseRevision = h.reserveExternalRevision();
  const initialResponse = h.coordinator.observeState(launcherState({
    library: { packs: [{ id: "pack-a" }] },
  }), "initial-state");
  h.flushTask();
  await flushPromises();

  const checkingPush = h.publications[0];
  assert.equal(initialResponseRevision, 1);
  assert.equal(checkingPush.meta.revision, 2);
  assert.equal(checkingPush.state.membership.status, "checking");
  assert.equal(checkingPush.state.selection.activeInstanceKey, "pack-a");
  assert.equal(checkingPush.state.session.userId, "account-a");
  assert.deepEqual(checkingPush.state.library, { packs: [{ id: "pack-a" }] });
  assert.equal(initialResponse.membership.status, "checking");
  assert.equal(initialResponse.selection.activeInstanceKey, checkingPush.state.selection.activeInstanceKey);
  assert.equal(initialResponse.session.userId, checkingPush.state.session.userId);
  h.coordinator.shutdown("test-cleanup");
  assert.equal(h.timers.size, 0);
});

test("a synchronous execute throw is captured and settles the reserved run", async () => {
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => {
      throw new Error("synchronous failure");
    },
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();

  assert.equal(h.calls.length, 1);
  assert.equal(h.coordinator.isActive(), false);
  assert.equal(h.coordinator.getCurrentState().membership.status, "error");
  assert.equal(h.publications.at(-1).meta.phase, "result");
  assert.equal(h.publications.at(-1).meta.revision, 2);
  assert.equal(h.timers.size, 0);
});

test("invalidate removes the live checking projection even when it does not publish", async () => {
  const request = deferred();
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
    execute: () => request.promise,
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  const publicationsBeforeInvalidate = h.publications.length;
  const signal = h.calls[0].signal;

  const stable = h.coordinator.invalidate("manual-membership");
  assert.equal(signal.aborted, true);
  assert.notEqual(stable.membership.status, "checking");
  assert.notEqual(h.coordinator.getCurrentState().membership.status, "checking");
  assert.equal(h.publications.length, publicationsBeforeInvalidate);
  assert.equal(h.coordinator.getDiagnostics().attempted, 0);
  assert.equal(h.timers.size, 0);
});

test("reauthentication and pack mutations invalidate terminal membership while account switching preserves it", async () => {
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
  });
  h.coordinator.observeState(launcherState(), "initial-state");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 1);
  assert.equal(h.coordinator.getCurrentState().membership.status, "member");

  h.coordinator.invalidate("login");
  const afterLogin = h.coordinator.observeState(launcherState({
    session: { sessionRevision: 4 },
  }), "reauthenticated-session");
  assert.equal(afterLogin.membership.status, "checking");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 2);

  h.coordinator.invalidate("pack-rescan");
  const afterPackMutation = h.coordinator.observeState(launcherState(), "rescanned-pack");
  assert.equal(afterPackMutation.membership.status, "checking");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 0);
});

test("an incoming checking snapshot without a live run is normalized to a stable retryable state", () => {
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
  });
  const orphan = h.coordinator.observeState(launcherState({
    membership: {
      canPlayCompetition: false,
      generation: 99,
      request: { contextCurrent: true, inFlight: true },
      status: "checking",
      technicalReason: "membership-request-active",
    },
    readiness: { canPlayCompetition: false, status: "blocked" },
  }), "orphaned-checking");

  assert.equal(orphan.membership.status, "error");
  assert.equal(orphan.membership.request, null);
  assert.equal(orphan.membership.resolution, null);
  assert.equal(orphan.membership.retryable, true);
  assert.equal(h.coordinator.isActive(), false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.tasks.length, 0);
  assert.equal(h.timers.size, 0);
});

test("coordinator has no polling, uses an operational injected deadline and keeps caches bounded", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "membership-startup-coordinator.js"), "utf8");
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /options\.setTimeout \|\| setTimeout/);
  assert.match(source, /options\.clearTimeout \|\| clearTimeout/);
  const h = harness({
    initialConnection: {
      activity: "active",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: 1,
    },
  });
  for (let index = 0; index < 70; index += 1) {
    const accountId = `account-${index}`;
    const packId = `pack-${index}`;
    h.coordinator.observeState(launcherState({
      accounts: { activeUserId: accountId, knownAccounts: [{ isActive: true, userId: accountId }] },
      game: { instanceKey: packId, weekId: `week-${index}` },
      membership: { weekId: `week-${index}` },
      selection: { activeInstanceKey: packId },
      session: { userId: accountId },
    }), "bounded-identity");
    h.flushTask();
    await flushPromises();
  }
  assert.ok(h.coordinator.getDiagnostics().attempted <= 64);
  assert.ok(h.coordinator.getDiagnostics().terminals <= 64);
  const evicted = h.coordinator.observeState(stateForIdentity("account-0", "pack-0", "week-0"), "evicted-identity");
  assert.equal(evicted.membership.status, "checking");
  h.flushTask();
  await flushPromises();
  assert.equal(h.calls.length, 71);
  assert.equal(h.timers.size, 0);
});
