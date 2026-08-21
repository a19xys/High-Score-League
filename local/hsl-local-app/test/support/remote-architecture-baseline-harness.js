const { createAccountProfileSync } = require("../../src/account-profile-sync");
const { createConnectivityService, isCommittedConnected } = require("../../src/connectivity-service");
const { createMembershipStartupCoordinator } = require("../../src/membership-startup-coordinator");
const { createNetworkTopologyMonitor } = require("../../src/network-topology-monitor");
const { createPendingAutoSubmitCoordinator } = require("../../src/pending-auto-submit-coordinator");
const { createPlayTimeSyncService } = require("../../src/playtime-sync-service");
const { createPresenceService } = require("../../src/presence-service");
const { createRankingCapabilitiesService } = require("../../src/ranking-capabilities-service");
const { checkSeasonMembership } = require("../../src/season-membership");
const { createSessionResult } = require("../../src/session-result");
const { createWeekCapabilitiesService } = require("../../src/week-capabilities-service");

const BASELINE_NOW = Date.parse("2026-08-21T10:00:00.000Z");
const DEPLOYMENT = Object.freeze({ apiVersion: 1, build: "baseline-build", environment: "test" });
const HSL_ORIGIN = "https://hsl.test";
const SUPABASE_ORIGIN = "https://fixture.supabase.co";

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createFakeClock(initialNow = BASELINE_NOW) {
  let current = initialNow;
  let nextId = 0;
  let executed = 0;
  const timers = new Map();

  function timerHandle(id) {
    return { id, unref() {} };
  }

  function timerId(handle) {
    return typeof handle === "object" && handle ? handle.id : handle;
  }

  function schedule(callback, delay, intervalMs = null) {
    const id = ++nextId;
    timers.set(id, {
      at: current + Math.max(0, Number(delay) || 0),
      callback,
      id,
      intervalMs,
    });
    return timerHandle(id);
  }

  async function settleMicrotasks() {
    for (let index = 0; index < 4; index += 1) await flushAsyncWork();
  }

  return {
    clearInterval(handle) { timers.delete(timerId(handle)); },
    clearTimeout(handle) { timers.delete(timerId(handle)); },
    executedCount() { return executed; },
    jumpBy(ms) { current += Math.max(0, Number(ms) || 0); },
    now() { return current; },
    pendingCount() { return timers.size; },
    setInterval(callback, delay = 0) { return schedule(callback, delay, Math.max(1, Number(delay) || 1)); },
    setTimeout(callback, delay = 0) { return schedule(callback, delay); },
    async advanceBy(ms) {
      const target = current + Math.max(0, Number(ms) || 0);
      let guard = 0;
      while (true) {
        const next = [...timers.values()]
          .filter((timer) => timer.at <= target)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0];
        if (!next) break;
        if (++guard > 100_000) throw new Error("fake clock runaway");
        current = Math.max(current, next.at);
        if (next.intervalMs === null) timers.delete(next.id);
        else timers.set(next.id, { ...next, at: next.at + next.intervalMs });
        executed += 1;
        await next.callback();
        await settleMicrotasks();
      }
      current = target;
      await settleMicrotasks();
    },
  };
}

function classifyRequest(url, purpose = null) {
  if (purpose && ["avatar", "auth", "health", "membership", "other", "playtime", "presence", "profile", "ranking-capabilities", "submission", "week-capabilities"].includes(purpose)) {
    return purpose;
  }
  let pathname = "";
  try { pathname = new URL(String(url)).pathname; } catch {}
  if (pathname === "/api/launcher/health") return "health";
  if (pathname === "/api/local/season-membership") return "membership";
  if (pathname === "/api/launcher/week-capabilities") return "week-capabilities";
  if (pathname === "/api/launcher/ranking-capabilities") return "ranking-capabilities";
  if (pathname === "/api/launcher/presence") return "presence";
  if (pathname === "/api/launcher/playtime/ingest") return "playtime";
  if (pathname === "/api/submissions/ingest") return "submission";
  if (pathname.startsWith("/rest/v1/profiles")) return "profile";
  if (pathname.startsWith("/storage/v1/object/")) return "avatar";
  if (pathname.startsWith("/auth/v1/")) return "auth";
  return "other";
}

function sanitizedUrl(value) {
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    url.hash = "";
    const keys = [...new Set([...url.searchParams.keys()])].sort();
    url.search = "";
    for (const key of keys) url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

function createRequestRecorder() {
  const calls = [];
  return {
    clear() { calls.length = 0; },
    counts() {
      const counts = Object.fromEntries([
        "health", "membership", "week-capabilities", "ranking-capabilities", "presence",
        "playtime", "submission", "profile", "avatar", "auth", "other",
      ].map((category) => [category, 0]));
      for (const call of calls) counts[call.category] += 1;
      return counts;
    },
    list() { return calls.map((call) => ({ ...call })); },
    record(url, init = {}, purpose = null) {
      const call = Object.freeze({
        category: classifyRequest(url, purpose),
        method: String(init.method || "GET").toUpperCase(),
        url: sanitizedUrl(url),
      });
      calls.push(call);
      return call;
    },
  };
}

function responseHeaders(deployment = DEPLOYMENT, contentType = null) {
  const values = {
    "content-type": contentType,
    "x-hsl-build": deployment.build,
    "x-hsl-environment": deployment.environment,
    "x-hsl-launcher-api-version": String(deployment.apiVersion),
  };
  return { get(name) { return values[String(name).toLowerCase()] || null; } };
}

function validSession() {
  return createSessionResult({
    sessionRevision: 1,
    status: "valid",
    storedSession: {
      session: { access_token: "fixture-access-token", expires_at: 2_000_000_000 },
      user: { id: "user-a" },
    },
  });
}

function createMemoryWeekCache(clock) {
  const entries = new Map();
  return {
    path: null,
    async initialize() { return { entries: [] }; },
    async remember(context, capability) {
      entries.set(`${context.origin}|${context.authorityKey}|${capability.weekId}`, { ...capability });
      return capability;
    },
    read(context, weekId) {
      const entry = entries.get(`${context.origin}|${context.authorityKey}|${weekId}`);
      if (!entry) return null;
      return {
        ...entry,
        canPlayCompetition: entry.publicState === "active",
        confirmedPublicState: entry.publicState,
        lastKnownPublicState: entry.publicState,
        nextBoundaryAt: null,
        source: "durable-cache",
      };
    },
    snapshot() { return { entries: [...entries.values()], measuredAt: new Date(clock.now()).toISOString() }; },
  };
}

function emptyLogicalCounters() {
  return {
    autoSubmitRequest: 0,
    connectivityRefresh: 0,
    connectivityEmissions: 0,
    membershipConnectivityUpdate: 0,
    membershipObserve: 0,
    playtimeRequest: 0,
    presenceSetOnline: 0,
    profileRequest: 0,
    rankingRefresh: 0,
    sessionMaintenance: 0,
    weekRefresh: 0,
  };
}

function addLogical(target, name) {
  target[name] = (target[name] || 0) + 1;
}

function createLauncherState(membership) {
  return {
    accounts: { activeUserId: "user-a" },
    competitionAccess: { canPlayCompetition: membership?.status === "member" },
    game: { instanceKey: "pack-a", weekId: "week-a" },
    membership: membership || {
      canPlayCompetition: false,
      canSubmit: false,
      revalidationRequired: true,
      status: "unknown",
      technicalReason: "deferred",
      weekId: "week-a",
    },
    readiness: {
      blockers: [],
      canCapture: true,
      canPlayCompetition: membership?.status === "member",
      canPractice: true,
      canSubmit: membership?.canSubmit === true,
      checks: [],
      status: "warning",
      warnings: [],
    },
    remoteConfiguration: { status: "valid" },
    selection: { activeInstanceKey: "pack-a" },
    session: { hasSession: true, requiresLogin: false, sessionRevision: 1, userId: "user-a" },
  };
}

async function createBaselineSystem(options = {}) {
  const clock = createFakeClock(options.initialNow || BASELINE_NOW);
  const recorder = createRequestRecorder();
  const logical = emptyLogicalCounters();
  let systemOnline = options.systemOnline !== false;
  let hslReachable = options.hslReachable !== false;
  let netChecks = 0;
  let topologyInterfaces = {
    Ethernet: [{ address: "192.0.2.10", cidr: "192.0.2.10/24", family: "IPv4", internal: false, netmask: "255.255.255.0" }],
  };
  const session = validSession();
  const connection = () => connectivity.getState();

  async function fetchImpl(url, init = {}) {
    const request = recorder.record(url, init);
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/launcher/health") {
      if (!hslReachable) throw Object.assign(new Error("fixture-unreachable"), { code: "ENOTFOUND" });
      return { headers: responseHeaders(), ok: true, status: 204, url: parsed.toString() };
    }
    if (parsed.pathname === "/api/launcher/week-capabilities") {
      const payload = JSON.parse(init.body || "{}");
      return new Response(JSON.stringify({
        build: DEPLOYMENT.build,
        environment: DEPLOYMENT.environment,
        results: (payload.requests || []).map((item) => ({
          derivedStatus: "active",
          publicState: "active",
          rawStatus: "active",
          reason: "week-active",
          requestKey: item.requestKey,
          seasonId: "season-a",
          seasonStatus: "active",
          weekId: item.weekId,
        })),
        version: 1,
      }), { status: 200, headers: {
        "content-type": "application/json",
        "x-hsl-build": DEPLOYMENT.build,
        "x-hsl-environment": DEPLOYMENT.environment,
        "x-hsl-launcher-api-version": "1",
      } });
    }
    if (parsed.pathname === "/api/launcher/ranking-capabilities") {
      const payload = JSON.parse(init.body || "{}");
      return new Response(JSON.stringify({
        build: DEPLOYMENT.build,
        environment: DEPLOYMENT.environment,
        results: (payload.requests || []).map((item) => ({
          reason: "available",
          requestKey: item.requestKey,
          status: "available",
          url: `${HSL_ORIGIN}/ranking/${item.weekId}`,
          weekId: item.weekId,
        })),
        version: 1,
      }), { status: 200, headers: {
        "content-type": "application/json",
        "x-hsl-build": DEPLOYMENT.build,
        "x-hsl-environment": DEPLOYMENT.environment,
        "x-hsl-launcher-api-version": "1",
      } });
    }
    if (parsed.pathname === "/api/local/season-membership") {
      return new Response(JSON.stringify({
        canSubmit: true,
        seasonId: "season-a",
        status: "member",
        weekId: "week-a",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (parsed.pathname === "/rest/v1/profiles") {
      return new Response(JSON.stringify([{
        avatar_storage_path: null,
        avatar_url: null,
        id: "user-a",
        initials: "UA",
        username: "fixture-user",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unhandled baseline request: ${request.category}`);
  }

  const connectivity = createConnectivityService({
    config: options.connectivityConfig,
    fetchImpl,
    netIsOnline: () => { netChecks += 1; return systemOnline; },
    now: clock.now,
    random: () => 0.5,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    webBaseUrl: HSL_ORIGIN,
  });
  const week = createWeekCapabilitiesService({
    cache: createMemoryWeekCache(clock),
    clearTimeout: clock.clearTimeout,
    fetchImpl,
    getConnectivityState: connection,
    now: clock.now,
    setTimeout: clock.setTimeout,
  });
  const ranking = createRankingCapabilitiesService({
    clearTimeout: clock.clearTimeout,
    fetchImpl,
    getConnectivityState: connection,
    now: clock.now,
    setTimeout: clock.setTimeout,
  });
  const profile = createAccountProfileSync({
    config: { supabaseAnonKey: "fixture-anon-key", supabaseUrl: SUPABASE_ORIGIN, userDataDir: "C:/baseline-fixture" },
    fetchImpl,
    getConnectivityState: connection,
    now: clock.now,
    readKnownAccountsImpl: async () => ({ accounts: [{ userId: "user-a" }], lastActiveUserId: "user-a" }),
    resolveSessionResultImpl: async () => session,
    updateKnownAccountProfileImpl: async () => {},
  });
  const playtime = createPlayTimeSyncService({
    config: { webBaseUrl: HSL_ORIGIN },
    createStoreImpl: () => ({ listPending: async () => [] }),
    getConnectivityState: connection,
    now: clock.now,
    readKnownAccountsImpl: async () => ({ accounts: [{ userId: "user-a" }] }),
    resolveSessionResultImpl: async () => session,
  });
  const presence = createPresenceService({
    clearTimeout: clock.clearTimeout,
    config: { userDataDir: "C:/baseline-fixture", webBaseUrl: HSL_ORIGIN },
    getClientIdImpl: async () => "11111111-1111-4111-8111-111111111111",
    getConnectivityState: connection,
    requestPresenceImpl: async (request) => {
      recorder.record(`${HSL_ORIGIN}/api/launcher/presence`, { method: request.method }, "presence");
      return { httpStatus: 200, ok: true };
    },
    resolveSessionResultImpl: async () => session,
    setTimeout: clock.setTimeout,
  });
  let launcherState = createLauncherState();
  const membership = createMembershipStartupCoordinator({
    clearTimeout: clock.clearTimeout,
    connectivityTimeoutMs: connectivity.config.healthTimeoutMs,
    execute: async ({ signal }) => {
      const result = await checkSeasonMembership({
        defaultWeekId: "week-a",
        webBaseUrl: HSL_ORIGIN,
      }, launcherState.session, {
        fetchImpl,
        sessionResult: session,
        signal,
      });
      launcherState = createLauncherState(result);
      return launcherState;
    },
    getConnectivityState: connection,
    now: clock.now,
    queueTask: (task) => queueMicrotask(task),
    remoteTimeoutMs: 15_000,
    reserveRevision: (() => { let revision = 0; return () => ++revision; })(),
    setTimeout: clock.setTimeout,
  });
  const autoSubmit = createPendingAutoSubmitCoordinator({
    autoScheduleSessionRetry: true,
    clearTimeoutImpl: clock.clearTimeout,
    inspect: async () => ({
      accountContexts: [],
      connection: connection(),
      index: { revision: "empty-queue", totals: { pending: 0 } },
      playerKey: "player-a",
      session: { hasSession: true, userId: "user-a" },
      sessionIdentities: [{ sessionRevision: 1, userId: "user-a" }],
      sessionRevision: 1,
      userId: "user-a",
      webBaseUrl: HSL_ORIGIN,
    }),
    now: clock.now,
    run: async () => { throw new Error("empty baseline queue must not run"); },
    setTimeoutImpl: clock.setTimeout,
  });
  const topology = createNetworkTopologyMonitor({
    clearInterval: clock.clearInterval,
    networkInterfaces: () => topologyInterfaces,
    now: clock.now,
    onChange(change) {
      if (change.snapshot.externalAddressCount === 0 && !systemOnline) {
        connectivity.confirmSystemOffline("topology-change");
        return;
      }
      addLogical(logical, "connectivityRefresh");
      connectivity.refresh("topology-change", { detectedAt: change.detectedAt, force: true, phase: "retry", supersede: true }).catch(() => {});
    },
    setInterval: clock.setInterval,
  });

  let previousReachability = "unknown";
  const removeConnectivityListener = connectivity.subscribe((state) => {
    addLogical(logical, "connectivityEmissions");
    const becameConnected = state.reachability === "connected" && previousReachability !== "connected";
    previousReachability = state.reachability;
    ranking.updateDeployment();
    week.updateDeployment();
    addLogical(logical, "presenceSetOnline");
    presence.setOnline(isCommittedConnected(state), state.source || "connectivity-change").catch(() => {});
    addLogical(logical, "membershipConnectivityUpdate");
    membership.updateConnectivity(state, becameConnected ? "connectivity-restored" : "connectivity-change");
    if (!isCommittedConnected(state)) return;
    addLogical(logical, "profileRequest");
    profile.request(becameConnected ? "connectivity-restored" : "connectivity-confirmed").catch(() => {});
    addLogical(logical, "playtimeRequest");
    playtime.request(becameConnected ? "connectivity-restored" : "connectivity-confirmed").catch(() => {});
    addLogical(logical, "rankingRefresh");
    ranking.refresh(becameConnected ? "connectivity-restored" : "connectivity-confirmed").catch(() => {});
    addLogical(logical, "weekRefresh");
    week.refresh(becameConnected ? "connectivity-restored" : "connectivity-confirmed", { force: becameConnected }).catch(() => {});
    if (becameConnected) {
      addLogical(logical, "autoSubmitRequest");
      autoSubmit.request(state.source === "startup" ? "startup" : "connectivity-restored").catch(() => {});
    }
  });

  await week.initialize();
  ranking.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: HSL_ORIGIN });
  week.updateContext({ packs: [{ weekId: "week-a" }], webBaseUrl: HSL_ORIGIN });
  await presence.start();
  await presence.setActiveUserId("user-a");
  topology.start();
  addLogical(logical, "connectivityRefresh");
  await connectivity.start("startup");
  addLogical(logical, "membershipObserve");
  launcherState = membership.observeState(launcherState, "launcher-state");
  addLogical(logical, "rankingRefresh");
  ranking.refresh("launcher-state").catch(() => {});
  addLogical(logical, "weekRefresh");
  week.refresh("launcher-state").catch(() => {});
  addLogical(logical, "autoSubmitRequest");
  autoSubmit.request("state-ready").catch(() => {});
  const maintenanceTimer = clock.setInterval(() => {
    addLogical(logical, "sessionMaintenance");
    addLogical(logical, "autoSubmitRequest");
    return autoSubmit.request("session-maintenance");
  }, 60_000);

  async function settle() {
    for (let index = 0; index < 30; index += 1) await flushAsyncWork();
  }
  await settle();

  let windowBase = { clockExecutions: 0, netChecks: 0, topologyProbes: 0 };

  function resetWindow() {
    recorder.clear();
    Object.assign(logical, emptyLogicalCounters());
    windowBase = {
      clockExecutions: clock.executedCount(),
      netChecks,
      topologyProbes: topology.getDiagnostics().topologyProbeCount,
    };
  }

  function snapshot(label) {
    const topologyDiagnostics = topology.getDiagnostics();
    return {
      label,
      local: {
        netIsOnlineInspections: netChecks - windowBase.netChecks,
        timerCallbacks: clock.executedCount() - windowBase.clockExecutions,
        timersPending: clock.pendingCount(),
        topologyChanges: topologyDiagnostics.topologyGeneration,
        topologyInspections: topologyDiagnostics.topologyProbeCount - windowBase.topologyProbes,
      },
      logical: { ...logical },
      remote: recorder.counts(),
      requests: recorder.list(),
      state: {
        autoSubmit: autoSubmit.getDiagnostics(),
        connectivity: connectivity.getDiagnostics(),
        membership: membership.getDiagnostics(),
        presence: presence.getDiagnostics(),
        profile: profile.getDiagnostics(),
        ranking: ranking.getDiagnostics("week-a"),
        week: week.getDiagnostics(),
      },
    };
  }

  async function stop() {
    clock.clearInterval(maintenanceTimer);
    removeConnectivityListener();
    membership.shutdown("shutdown");
    autoSubmit.shutdown("shutdown");
    profile.shutdown();
    playtime.shutdown();
    ranking.stop();
    week.stop();
    topology.stop();
    connectivity.stop();
    await presence.shutdown();
    await settle();
  }

  return {
    autoSubmit,
    clock,
    connectivity,
    logical,
    membership,
    presence,
    profile,
    ranking,
    recorder,
    resetWindow,
    setHslReachable(value) { hslReachable = value === true; },
    setSystemOnline(value) { systemOnline = value === true; },
    setTopologyInterfaces(value) { topologyInterfaces = value; },
    settle,
    snapshot,
    stop,
    topology,
    week,
  };
}

async function measureIdleOnline(activity = "active") {
  const system = await createBaselineSystem();
  const startup = system.snapshot("startup-online");
  if (activity === "background") {
    system.connectivity.setActivity("background", "blur");
    await system.settle();
  }
  system.resetWindow();
  await system.clock.advanceBy(10 * 60 * 1000);
  await system.settle();
  const idle = system.snapshot(`idle-online-${activity}-10m`);
  await system.stop();
  return { idle, startup, timersAfterStop: system.clock.pendingCount() };
}

async function measureUnavailable({ hslReachable, systemOnline }) {
  const system = await createBaselineSystem({ hslReachable, systemOnline });
  await system.clock.advanceBy(5 * 60 * 1000);
  await system.settle();
  const measurement = system.snapshot(systemOnline ? "system-online-hsl-unreachable-5m" : "system-offline-5m");
  await system.stop();
  return { measurement, timersAfterStop: system.clock.pendingCount() };
}

async function measureReconnect() {
  const system = await createBaselineSystem({ systemOnline: false });
  system.resetWindow();
  system.setSystemOnline(true);
  addLogical(system.logical, "connectivityRefresh");
  const recovery = system.connectivity.signalPossibleRecovery("renderer-online");
  await system.clock.advanceBy(system.connectivity.config.positiveSignalDebounceMs);
  await recovery;
  await system.settle();
  const measurement = system.snapshot("offline-to-online");
  await system.stop();
  return { measurement, timersAfterStop: system.clock.pendingCount() };
}

async function measureFocus() {
  const system = await createBaselineSystem({
    connectivityConfig: { connectedActiveIntervalMs: 10 * 60 * 1000, connectedBackgroundIntervalMs: 10 * 60 * 1000 },
  });
  system.resetWindow();
  addLogical(system.logical, "connectivityRefresh");
  await system.connectivity.refresh("focus", { maxAgeMs: system.connectivity.config.focusStaleMs, phase: "background" });
  addLogical(system.logical, "weekRefresh");
  await system.week.refresh("focus");
  await system.settle();
  const fresh = system.snapshot("focus-fresh");
  system.resetWindow();
  system.clock.jumpBy(system.connectivity.config.focusStaleMs + 1);
  addLogical(system.logical, "connectivityRefresh");
  await system.connectivity.refresh("focus", { maxAgeMs: system.connectivity.config.focusStaleMs, phase: "background" });
  addLogical(system.logical, "weekRefresh");
  await system.week.refresh("focus");
  await system.settle();
  const stale = system.snapshot("focus-stale");
  await system.stop();
  return { fresh, stale, timersAfterStop: system.clock.pendingCount() };
}

async function measureResume() {
  const system = await createBaselineSystem();
  system.week.setSuspended(true);
  system.presence.setSuspended(true);
  system.profile.cancel("suspend");
  system.membership.invalidate("suspend");
  system.autoSubmit.cancelCurrentRun("suspend");
  system.topology.stop();
  system.connectivity.setActivity("suspended", "suspend");
  await system.clock.advanceBy(2 * 60 * 1000);
  system.resetWindow();
  system.week.setSuspended(false);
  system.presence.setSuspended(false).catch(() => {});
  system.connectivity.setActivity("active", "resume");
  system.membership.resume("resume");
  system.topology.start();
  addLogical(system.logical, "autoSubmitRequest");
  system.autoSubmit.resume("resume").catch(() => {});
  addLogical(system.logical, "connectivityRefresh");
  const recovery = system.connectivity.signalPossibleRecovery("resume");
  await system.clock.advanceBy(system.connectivity.config.positiveSignalDebounceMs);
  await recovery;
  await system.settle();
  const measurement = system.snapshot("suspend-to-resume");
  await system.stop();
  return { measurement, timersAfterStop: system.clock.pendingCount() };
}

module.exports = {
  BASELINE_NOW,
  classifyRequest,
  createBaselineSystem,
  createFakeClock,
  createRequestRecorder,
  measureFocus,
  measureIdleOnline,
  measureReconnect,
  measureResume,
  measureUnavailable,
  sanitizedUrl,
};
