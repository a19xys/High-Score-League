const { contextBridge } = require("electron");

let activeIndex = 0;
let activeUserId = "fixture";
let connectivityStatus = "connected";
let connectivityStateListener = null;
let heroStatus = "ready";
let launcherStateRevision = 1;
let launcherStateListener = null;
let selectionPhase = "initial";
let switchAccountCalls = 0;
let accountFixtureMode = "existing";
let sessionFixtureMode = "valid";
let membershipFixtureStatus = "member";
let weekFixtureState = null;
const forgottenAccountIds = new Set();
const fixtureAvatarUrl = process.env.HSL_ACCOUNT_AVATAR_FILE_URL || null;

const titles = [
  "SPACE INVADERS Y EL TEMPLO DEL MALO MALOSO",
  "PAC MAN",
  "GALAGA",
  "DONKEY KONG",
];

const publicWeekStates = ["active", "inactive", "closed", "unlinked", "unknown"];

function weekCapability(publicState, weekId) {
  const linked = publicState !== "unlinked";
  return {
    canPlayCompetition: publicState === "active",
    conclusive: publicState !== "unknown",
    publicState,
    reason: publicState === "active"
      ? "week-active"
      : publicState === "inactive"
        ? "week-inactive"
        : publicState === "closed"
          ? "week-closed"
          : publicState === "unlinked" ? "not-linked" : "not-checked",
    seasonId: linked ? `season-${weekId}` : null,
    source: publicState === "unknown" ? "none" : "fixture",
    weekId: linked ? weekId : null,
  };
}

const packs = Array.from({ length: 40 }, (_, index) => ({
  cover: { url: "./assets/brand/logo-horizontal.png" },
  deprecated: index % 10 === 1,
  favorite: index % 3 === 0,
  favoriteKey: `pack-${index}`,
  id: `pack-${index}`,
  icon: { url: "./assets/brand/logo-horizontal.png" },
  instanceKey: `instance-${index}`,
  seasonId: `season-${Math.floor(index / 10)}`,
  seasonName: `Temporada ${Math.floor(index / 10) + 1}`,
  status: index % 10 === 3 ? "error" : index % 10 === 2 ? "warning" : "ok",
  subtitle: index === 1 ? "Pack de desarrollo" : `Semana ${index + 1}`,
  title: `${titles[index % titles.length]} ${index + 1}`,
  weekCapability: weekCapability(publicWeekStates[index % publicWeekStates.length], `week-${index}`),
  weekId: `week-${index}`,
  weekNumber: index + 1,
  year: String(1980 + index),
}));

if (process.env.HSL_LIBRARY_ALPHA_ASSETS) {
  const alphaAssets = JSON.parse(process.env.HSL_LIBRARY_ALPHA_ASSETS);
  const fixtures = [
    { key: "sprite", title: "ALFA EXTERIOR" },
    { key: "fullBleed", title: "FULL BLEED OPACO" },
    { key: "internalHole", title: "HUECO INTERIOR" },
    { key: "corners", title: "ESQUINAS TRANSPARENTES" },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    packs[index].cover = { url: alphaAssets.fullBleed };
    packs[index].icon = { url: alphaAssets[fixture.key] };
    packs[index].title = fixture.title;
  }
  packs[4].cover = { url: alphaAssets.fullBleed };
  delete packs[4].icon;
  packs[4].title = "FALLBACK DE PORTADA";
}

function snapshot({ samePack = false } = {}) {
  const pack = packs[activeIndex];
  const accounts = accountFixtureMode === "empty" ? [] : [
    { avatarLocalUrl: fixtureAvatarUrl, displayName: "Fixture", email: "fixture@example.test", hasLocalSession: true, initials: "FI", isActive: activeUserId === "fixture", userId: "fixture" },
    { displayName: "Cuenta disponible", email: "valid@example.test", hasLocalSession: true, initials: "RAF", isActive: activeUserId === "valid", userId: "valid" },
    { displayName: "Cuenta caducada inesperadamente", email: "expired@example.test", hasLocalSession: true, isActive: activeUserId === "expired", userId: "expired" },
    { displayName: "Cuenta con iniciales", email: "player.ygjpq@example.test", hasLocalSession: true, initials: "FUK", isActive: activeUserId === "typography", userId: "typography" },
    { displayName: "Cuenta AA", email: "aa@example.test", hasLocalSession: true, initials: "AA", isActive: activeUserId === "aa", userId: "aa" },
    { displayName: "Cuenta HSL", email: "hsl@example.test", hasLocalSession: true, initials: "HSL", isActive: activeUserId === "hsl", userId: "hsl" },
    { displayName: "Cuenta bloqueada", email: "relogin@example.test", hasLocalSession: false, isActive: false, requiresLogin: true, userId: "relogin" },
  ].filter((account) => !forgottenAccountIds.has(account.userId));
  const noActiveSession = accountFixtureMode === "remembered";
  const heroChecking = heroStatus === "checking" || membershipFixtureStatus === "checking";
  const heroError = heroStatus === "error";
  const currentWeekCapability = weekFixtureState
    ? weekCapability(weekFixtureState, pack.weekId)
    : pack.weekCapability;
  const hasSession = accountFixtureMode !== "empty" && !noActiveSession && sessionFixtureMode !== "revoked";
  const requiresLogin = sessionFixtureMode === "revoked";
  const effectiveMembershipStatus = membershipFixtureStatus === "cached_error" ? "member" : membershipFixtureStatus;
  const member = effectiveMembershipStatus === "member";
  const canPractice = !heroError;
  const canPlayCompetition = canPractice
    && !heroChecking
    && hasSession
    && !requiresLogin
    && member
    && currentWeekCapability.publicState === "active";
  const competitionReason = !canPractice
    ? "local-pack-unavailable"
    : requiresLogin
      ? "requires-login"
      : !hasSession
        ? "no-account"
        : effectiveMembershipStatus === "not_member"
          ? "not-member"
          : !member
            ? "membership-unknown"
            : currentWeekCapability.publicState === "inactive"
              ? "week-inactive"
              : currentWeekCapability.publicState === "closed"
                ? "week-closed"
                : currentWeekCapability.publicState === "unlinked" ? "week-unlinked" : "week-unknown";
  const membership = heroChecking
    ? {
        canPlayCompetition: false,
        canSubmit: false,
        generation: 7,
        resolution: {
          accountId: activeUserId,
          active: true,
          contextCurrent: true,
          generation: 7,
          instanceKey: pack.instanceKey,
          weekId: pack.weekId,
        },
        status: "checking",
        weekId: pack.weekId,
      }
    : membershipFixtureStatus === "not_member"
      ? { canPlayCompetition: false, canSubmit: false, status: "not_member", weekId: pack.weekId }
      : membershipFixtureStatus === "unauthenticated"
        ? { canPlayCompetition: false, canSubmit: false, status: "unauthenticated", weekId: pack.weekId }
        : membershipFixtureStatus === "cached_error"
          ? { canPlayCompetition: true, canSubmit: false, effectiveStatus: "member", revalidationRequired: true, status: "unknown", weekId: pack.weekId }
          : membershipFixtureStatus === "unknown"
            ? { canPlayCompetition: false, canSubmit: false, remoteFailure: "fixture", status: "unknown", weekId: pack.weekId }
            : { canPlayCompetition: true, canSubmit: true, effectiveStatus: "member", status: "member", weekId: pack.weekId };
  return {
    launcherStateRevision,
    accounts: {
      activeUserId: noActiveSession ? null : activeUserId,
      knownAccounts: noActiveSession ? accounts.map((account) => ({ ...account, isActive: false })) : accounts,
    },
    autoSync: { status: "idle" },
    bridge: {},
    competitionAccess: {
      canPlayCompetition,
      canPractice,
      canSubmitNow: canPlayCompetition && connectivityStatus === "connected",
      reason: canPlayCompetition ? "competition-ready" : competitionReason,
      requiresLogin,
      weekStatus: currentWeekCapability.publicState,
    },
    game: {
      assets: { logo: { url: "./assets/brand/logo-horizontal.png" } },
      developer: "HSL Fixture Studio",
      displayName: `${pack.title}${samePack ? " SAME" : ""}`,
      errors: heroError ? ["Error sintÃ©tico de fixture"] : [],
      favorite: true,
      genre: ["Arcade", "Shooter"],
      id: pack.id,
      instanceKey: pack.instanceKey,
      manual: { available: true },
      packId: pack.id,
      playTime: "12 h 34 min",
      shortDescription: "Fixture representativa con metadatos, acciones y actividad para verificar el final real del scroll.",
      weekId: pack.weekId,
      weekNumber: pack.weekNumber,
      year: pack.year,
      weekCapability: currentWeekCapability,
    },
    library: {
      directory: { available: true, configured: true, path: "C:/fixture-packs" },
      packs: packs.map((libraryPack) => ({
        ...libraryPack,
        weekCapability: libraryPack.id === pack.id ? currentWeekCapability : libraryPack.weekCapability,
      })),
      preferences: {
        filtersOpen: false,
        sidebarWidth: 440,
        sortBy: "weeks",
        sortDirection: "asc",
        view: "covers",
      },
      status: "available-populated",
      totals: { packs: packs.length },
    },
    membership,
    notices: [],
    queue: { totals: { failed: 0, pending: 0, sent: 0 } },
    readiness: {
      canPlayCompetition,
      canPractice,
      competitionAccess: {
        canPlayCompetition,
        canPractice,
        canSubmitNow: canPlayCompetition && connectivityStatus === "connected",
        reason: canPlayCompetition ? "competition-ready" : competitionReason,
        requiresLogin,
        weekStatus: currentWeekCapability.publicState,
      },
      blockers: heroChecking ? ["Comprobando participaciÃ³n."] : [],
      checks: heroError
        ? [{ id: "rom", level: "error" }]
        : membershipFixtureStatus === "not_member"
          ? [{ id: "membership", level: "error" }]
          : membershipFixtureStatus === "unauthenticated"
            ? [{ id: "session", level: "error" }]
            : [],
      status: heroError ? "error" : heroChecking || ["not_member", "unauthenticated"].includes(membershipFixtureStatus) ? "blocked" : "ready",
    },
    remoteConfiguration: { status: "configured" },
    selection: { activeInstanceKey: pack.instanceKey },
    session: accountFixtureMode === "empty" || noActiveSession || requiresLogin
      ? { hasSession: false, remoteUsable: false, requiresLogin, status: requiresLogin ? "revoked" : "missing", userId: requiresLogin ? activeUserId : null }
      : {
          email: accounts.find((account) => account.userId === activeUserId)?.email || "fixture@example.test",
          hasSession: true,
          remoteUsable: sessionFixtureMode === "valid",
          requiresLogin: false,
          shouldRetry: sessionFixtureMode === "deferred",
          status: sessionFixtureMode === "deferred" ? "deferred" : "ok",
          terminal: false,
          userId: activeUserId,
        },
    weekCapability: currentWeekCapability,
  };
}

function subscription(setter) {
  return (callback) => {
    setter(callback);
    return () => setter(null);
  };
}

contextBridge.exposeInMainWorld("hslLauncher", {
  getConnectivityState: async () => ({
    displayStatus: connectivityStatus,
    probe: { inFlight: false, phase: "idle" },
    reachability: connectivityStatus,
    reachabilityGeneration: 1,
  }),
  getInitialState: async () => snapshot(),
  getRankingCapabilitiesState: async () => ({ entries: {}, generation: 1, inFlight: false }),
  getState: async () => {
    await new Promise((resolve) => setTimeout(resolve, 24));
    selectionPhase = "refresh";
    launcherStateRevision += 1;
    return snapshot();
  },
  onBusyPhase: () => () => {},
  onConnectivityState: subscription((callback) => { connectivityStateListener = callback; }),
  onLauncherState: subscription((callback) => { launcherStateListener = callback; }),
  onRankingCapabilitiesState: () => () => {},
  platform: "win32",
  reportConnectivityApplied() {},
  reportRankingApplied() {},
  reportStartupMilestone() {},
  requestConnectivityRefresh: async () => ({ reachability: "connected", reachabilityGeneration: 1 }),
  resolveThemeBootstrap: () => ({ effectiveTheme: "dark", mode: "manual" }),
  setLibraryPreferences: async () => ({ ok: true }),
  setAccountFixtureMode: async (mode) => {
    accountFixtureMode = ["empty", "remembered"].includes(mode) ? mode : "existing";
    launcherStateRevision += 1;
    const state = snapshot();
    queueMicrotask(() => launcherStateListener?.({ state }));
    return state;
  },
  setActiveFixtureAccount: async (userId) => {
    activeUserId = userId;
    launcherStateRevision += 1;
    const state = snapshot();
    queueMicrotask(() => launcherStateListener?.({ state }));
    return state;
  },
  removeKnownAccount: async (userId) => {
    forgottenAccountIds.add(userId);
    if (activeUserId === userId) {
      const replacement = snapshot().accounts.knownAccounts.find((account) => account.hasLocalSession && !account.requiresLogin);
      activeUserId = replacement?.userId || null;
    }
    launcherStateRevision += 1;
    return { action: "remove-known-account", ok: true, state: snapshot(), summary: "Cuenta olvidada." };
  },
  setTheme: async (theme) => ({ effectiveTheme: theme === "light" ? "light" : "dark", ok: true }),
  switchAccount: async (userId) => {
    switchAccountCalls += 1;
    if (userId === "relogin") {
      return {
        email: "relogin@example.test",
        ok: false,
        requiresLogin: true,
        state: snapshot(),
        summary: "Inicia sesiÃ³n de nuevo para esta cuenta.",
      };
    }
    if (userId === "expired") {
      return {
        email: "expired@example.test",
        ok: false,
        requiresLogin: true,
        state: snapshot(),
        summary: "La sesiÃƒÂ³n caducÃƒÂ³ durante el cambio.",
      };
    }
    if (userId === "valid") activeUserId = "valid";
    launcherStateRevision += 1;
    return { ok: true, state: snapshot() };
  },
  startupTheme: Object.freeze({ effectiveTheme: "dark", legacyThemeMigrationAllowed: false }),
  toggleLibraryFavorite: async () => ({ ok: true }),
  useLibraryPack: async (packId) => {
    selectionPhase = "pending";
    await new Promise((resolve) => setTimeout(resolve, 28));
    activeIndex = packs.findIndex((pack) => pack.id === packId);
    selectionPhase = "accepted";
    launcherStateRevision += 1;
    return { ok: true, pack: packs[activeIndex], state: snapshot() };
  },
});

contextBridge.exposeInMainWorld("hslFixture", {
  emitConnectivityStatus(status) {
    connectivityStatus = status === "disconnected" ? "offline" : "connected";
    connectivityStateListener?.({
      displayStatus: connectivityStatus,
      probe: { inFlight: false, phase: "idle" },
      reachability: connectivityStatus,
      reachabilityGeneration: 2,
    });
  },
  emitHeroStatus(status) {
    heroStatus = ["checking", "error"].includes(status) ? status : "ready";
    launcherStateRevision += 1;
    launcherStateListener?.({ state: snapshot() });
  },
  emitMembershipStatus(status) {
    membershipFixtureStatus = ["cached_error", "checking", "not_member", "unauthenticated", "unknown"].includes(status) ? status : "member";
    heroStatus = "ready";
    launcherStateRevision += 1;
    launcherStateListener?.({ state: snapshot() });
  },
  emitSessionStatus(status) {
    sessionFixtureMode = ["deferred", "revoked"].includes(status) ? status : "valid";
    launcherStateRevision += 1;
    launcherStateListener?.({ state: snapshot() });
  },
  emitWeekStatus(status) {
    weekFixtureState = ["active", "inactive", "closed", "unlinked", "unknown"].includes(status) ? status : null;
    launcherStateRevision += 1;
    launcherStateListener?.({ state: snapshot() });
  },
  emitSamePackSnapshot() {
    launcherStateRevision += 1;
    launcherStateListener?.({ state: snapshot({ samePack: true }) });
  },
  getSwitchAccountCalls() {
    return switchAccountCalls;
  },
  getSelectionPhase() {
    return selectionPhase;
  },
});
