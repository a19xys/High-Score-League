const { contextBridge } = require("electron");

let activeIndex = 0;
let activeUserId = "fixture";
let connectivityStatus = "connected";
let connectivityStateListener = null;
let heroStatus = "ready";
let launcherStateRevision = 1;
let launcherStateListener = null;
let rankingCapabilitiesStateListener = null;
let selectionPhase = "initial";
let switchAccountCalls = 0;
let accountFixtureMode = "existing";
let sessionFixtureMode = "valid";
let membershipFixtureStatus = "member";
let weekFixtureState = null;
let competitionPreflightMode = "active";
let competitionLaunches = 0;
let practiceLaunches = 0;
let manualConnectivityRefreshCount = 0;
let manualConnectivityWeekIndex = 0;
let manualConnectivityWeekStates = ["closed", "active", "inactive"];
let manualConnectivityPublicationMode = "simple";
let activationPublicationMode = "simple";
let manualConnectivityPublications = [];
let passiveLibraryVariants = [];
let passiveLibraryVariantIndex = 0;
const libraryPublicationDiagnostics = [];
let delayLibraryPreferenceWrites = false;
let releaseLibraryPreferenceWrite = null;
const libraryPreferenceWrites = [];
const forgottenAccountIds = new Set();
const fixtureAvatarUrl = process.env.HSL_ACCOUNT_AVATAR_FILE_URL || null;
const preferenceProfiles = Object.freeze({
  fixture: Object.freeze({
    librarySortBy: "title",
    librarySortDirection: "desc",
    libraryView: "covers",
    sidebarWidth: 560,
    theme: "dark",
  }),
  global: Object.freeze({
    librarySortBy: "developer",
    librarySortDirection: "asc",
    libraryView: "list",
    sidebarWidth: 440,
    theme: "dark",
  }),
  valid: Object.freeze({
    librarySortBy: "weeks",
    librarySortDirection: "asc",
    libraryView: "icons",
    sidebarWidth: 360,
    theme: "light",
  }),
});

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

const fixturePackCount = Math.max(1, Number.parseInt(process.env.HSL_LIBRARY_PACK_COUNT || "40", 10) || 40);
const packs = Array.from({ length: fixturePackCount }, (_, index) => ({
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
let lastPublishedLibraryPacks = packs;

function libraryPacksForVariant(variant = "stable") {
  if (variant === "omit-last") return packs.slice(0, -1);
  if (variant === "covers-metadata") {
    return packs.map((pack, index) => index === packs.length - 1
      ? { ...pack, developer: "Transient Scan Studio" }
      : pack);
  }
  if (variant === "cover-asset") {
    return packs.map((pack, index) => index === packs.length - 1
      ? { ...pack, cover: { url: "./assets/brand/logo-mark.png" } }
      : pack);
  }
  return packs;
}

function nextPassiveLibraryVariant() {
  const variant = passiveLibraryVariants[passiveLibraryVariantIndex] || "stable";
  passiveLibraryVariantIndex += 1;
  return variant;
}

function recordLibraryPublication(type, variant, state) {
  libraryPublicationDiagnostics.push({
    directory: {
      available: state.library.directory.available,
      configured: state.library.directory.configured,
      path: state.library.directory.path,
    },
    instanceKeys: state.library.packs.map((pack) => pack.instanceKey),
    launcherStateRevision: state.launcherStateRevision,
    length: state.library.packs.length,
    packs: state.library.packs,
    previousPacks: lastPublishedLibraryPacks,
    sortBy: state.library.preferences.librarySortBy,
    sortDirection: state.library.preferences.librarySortDirection,
    status: state.library.status,
    type,
    variant,
    view: state.library.preferences.libraryView,
  });
  lastPublishedLibraryPacks = state.library.packs;
}

function publishLauncherFixture(type, payload = {}, variant = nextPassiveLibraryVariant()) {
  const state = snapshot({ libraryVariant: variant });
  recordLibraryPublication(type, variant, state);
  launcherStateListener?.({ ...payload, fixturePhase: type, state });
  return state;
}

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

function snapshot({ libraryVariant = "stable", samePack = false } = {}) {
  const pack = packs[activeIndex];
  const visiblePacks = libraryPacksForVariant(libraryVariant);
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
  const preferenceProfileId = accountFixtureMode === "empty" || noActiveSession
    ? "global"
    : activeUserId;
  const preferenceProfile = preferenceProfiles[preferenceProfileId] || preferenceProfiles.global;
  const preferenceScope = preferenceProfileId === "global"
    ? { playerKey: null, scope: "global", scopeKey: "global" }
    : { playerKey: `user_${preferenceProfileId}`, scope: "player", scopeKey: `player:user_${preferenceProfileId}` };
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
      errors: heroError ? ["Error sintáctico de fixture"] : [],
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
      packs: visiblePacks.map((libraryPack) => ({
        ...libraryPack,
        weekCapability: libraryPack.id === pack.id ? currentWeekCapability : libraryPack.weekCapability,
      })),
      preferences: {
        ...preferenceScope,
        librarySortBy: preferenceProfile.librarySortBy,
        librarySortDirection: preferenceProfile.librarySortDirection,
        libraryView: preferenceProfile.libraryView,
        sidebarWidth: preferenceProfile.sidebarWidth,
      },
      status: "available-populated",
      totals: { packs: visiblePacks.length },
    },
    membership,
    notices: [],
    preferenceScope,
    preferences: {
      scope: preferenceScope,
      theme: {
        effectiveTheme: preferenceProfile.theme,
        mode: "manual",
      },
    },
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
      blockers: heroChecking ? ["Comprobando participación."] : [],
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

async function performManualMembershipCheck({ publishFinal = false } = {}) {
  membershipFixtureStatus = "checking";
  launcherStateRevision += 1;
  publishLauncherFixture("manual-membership-checking", { membershipResolution: { phase: "checking" } });
  await Promise.resolve();
  membershipFixtureStatus = "member";
  launcherStateRevision += 1;
  const variant = nextPassiveLibraryVariant();
  const state = snapshot({ libraryVariant: variant });
  recordLibraryPublication("manual-membership-final", variant, state);
  if (publishFinal) launcherStateListener?.({ fixturePhase: "manual-membership-final", state });
  return { action: "check-membership", lines: [], ok: true, state, summary: "Participación actualizada." };
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
    if (activationPublicationMode === "revalidate") {
      membershipFixtureStatus = "checking";
      weekFixtureState = "unknown";
      launcherStateRevision += 1;
      const checking = snapshot();
      setTimeout(() => {
        membershipFixtureStatus = "member";
        weekFixtureState = "active";
        launcherStateRevision += 1;
        launcherStateListener?.({ competitionAuthority: true, fixturePhase: "activation-final", state: snapshot() });
      }, 48);
      return checking;
    }
    launcherStateRevision += 1;
    return snapshot();
  },
  onBusyPhase: () => () => {},
  onConnectivityState: subscription((callback) => { connectivityStateListener = callback; }),
  onLauncherState: subscription((callback) => { launcherStateListener = callback; }),
  onRankingCapabilitiesState: subscription((callback) => { rankingCapabilitiesStateListener = callback; }),
  playCompetition: async () => {
    if (competitionPreflightMode === "closed") {
      weekFixtureState = "closed";
      launcherStateRevision += 1;
      const state = snapshot();
      queueMicrotask(() => launcherStateListener?.({ state }));
      return { action: "play-competition", lines: ["La semana está cerrada. Puedes practicar."], ok: false, state, summary: "La semana está cerrada. Puedes practicar." };
    }
    if (competitionPreflightMode === "failure") {
      return { action: "play-competition", lines: ["No se pudo confirmar que la semana siga activa. Puedes practicar."], ok: false, state: snapshot(), summary: "No se pudo confirmar la semana activa." };
    }
    competitionLaunches += 1;
    return { action: "play-competition", lines: ["MAME fixture iniciado."], ok: true, state: snapshot(), summary: "Competición iniciada." };
  },
  platform: "win32",
  practice: async () => {
    practiceLaunches += 1;
    return { action: "practice", lines: ["Práctica fixture iniciada."], ok: true, state: snapshot(), summary: "Práctica iniciada." };
  },
  reportConnectivityApplied() {},
  reportRankingApplied() {},
  reportStartupMilestone() {},
  requestConnectivityRefresh: async () => {
    manualConnectivityRefreshCount += 1;
    manualConnectivityPublications.push("connectivity-start");
    connectivityStateListener?.({
      displayStatus: "connected",
      probe: { inFlight: true, phase: "manual" },
      reachability: "connected",
      reachabilityGeneration: manualConnectivityRefreshCount + 1,
    });
    if (manualConnectivityPublicationMode === "expanded") {
      weekFixtureState = "unknown";
      launcherStateRevision += 1;
      manualConnectivityPublications.push("deployment-context");
      publishLauncherFixture("deployment-context", { competitionAuthority: true });
      await new Promise((resolve) => setTimeout(resolve, 250));
      membershipFixtureStatus = "checking";
      launcherStateRevision += 1;
      manualConnectivityPublications.push("membership-checking");
      publishLauncherFixture("membership-checking", { membershipResolution: { phase: "checking" } });
      await new Promise((resolve) => setTimeout(resolve, 250));
      membershipFixtureStatus = "member";
      launcherStateRevision += 1;
      manualConnectivityPublications.push("profile-and-membership");
      publishLauncherFixture("profile-and-membership", { accountProfiles: true });
    }
    manualConnectivityPublications.push("ranking-capabilities");
    rankingCapabilitiesStateListener?.({
      entries: {},
      generation: manualConnectivityRefreshCount + 1,
      inFlight: false,
      stateSequence: manualConnectivityRefreshCount + 1,
    });
    await Promise.resolve();
    connectivityStateListener?.({
      displayStatus: "connected",
      probe: { inFlight: false, phase: "idle" },
      reachability: "connected",
      reachabilityGeneration: manualConnectivityRefreshCount + 1,
    });
    manualConnectivityPublications.push("connectivity-settled");
    const nextWeekState = manualConnectivityWeekStates[
      manualConnectivityWeekIndex % manualConnectivityWeekStates.length
    ];
    manualConnectivityWeekIndex += 1;
    setTimeout(() => {
      weekFixtureState = nextWeekState;
      launcherStateRevision += 1;
      manualConnectivityPublications.push("week-final");
      publishLauncherFixture("week-final", { competitionAuthority: true });
    }, 0);
    return { reachability: "connected", reachabilityGeneration: manualConnectivityRefreshCount + 1 };
  },
  checkMembership: () => performManualMembershipCheck(),
  resolveThemeBootstrap: () => ({ effectiveTheme: "dark", mode: "manual" }),
  setLibraryPreferences: async (patch) => {
    libraryPreferenceWrites.push(JSON.parse(JSON.stringify(patch || {})));
    if (delayLibraryPreferenceWrites) {
      await new Promise((resolve) => { releaseLibraryPreferenceWrite = resolve; });
      releaseLibraryPreferenceWrite = null;
    }
    return { ok: true };
  },
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
  setTheme: async (theme, scopeKey) => ({ effectiveTheme: theme === "light" ? "light" : "dark", ok: true, scopeKey }),
  switchAccount: async (userId) => {
    switchAccountCalls += 1;
    if (userId === "relogin") {
      return {
        email: "relogin@example.test",
        ok: false,
        requiresLogin: true,
        state: snapshot(),
        summary: "Inicia sesión de nuevo para esta cuenta.",
      };
    }
    if (userId === "expired") {
      return {
        email: "expired@example.test",
        ok: false,
        requiresLogin: true,
        state: snapshot(),
        summary: "La sesión caducó durante el cambio.",
      };
    }
    activeUserId = userId;
    launcherStateRevision += 1;
    return { ok: true, state: snapshot() };
  },
  login: async () => {
    accountFixtureMode = "existing";
    activeUserId = "fixture";
    launcherStateRevision += 1;
    return { action: "login", ok: true, state: snapshot(), summary: "Login fixture correcto." };
  },
  logout: async () => {
    accountFixtureMode = "empty";
    activeUserId = null;
    launcherStateRevision += 1;
    return { action: "logout", ok: true, state: snapshot(), summary: "Logout fixture correcto." };
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
  clearLibraryPreferenceWrites() {
    libraryPreferenceWrites.length = 0;
  },
  getLibraryPreferenceWrites() {
    return JSON.parse(JSON.stringify(libraryPreferenceWrites));
  },
  releaseLibraryPreferenceWrite() {
    delayLibraryPreferenceWrites = false;
    releaseLibraryPreferenceWrite?.();
  },
  setLibraryPreferenceWriteDelay(value) {
    delayLibraryPreferenceWrites = value === true;
  },
  competitionCounts() {
    return { competitionLaunches, practiceLaunches };
  },
  getManualConnectivityRefreshCount() {
    return manualConnectivityRefreshCount;
  },
  getManualConnectivityPublications() {
    return [...manualConnectivityPublications];
  },
  getLibraryPublicationDiagnostics() {
    return JSON.parse(JSON.stringify(libraryPublicationDiagnostics));
  },
  clearLibraryPublicationDiagnostics() {
    libraryPublicationDiagnostics.length = 0;
  },
  runManualMembershipRefresh() {
    return performManualMembershipCheck({ publishFinal: true });
  },
  setPassiveLibraryVariants(variants) {
    passiveLibraryVariants = Array.isArray(variants)
      ? variants.filter((variant) => ["stable", "omit-last", "covers-metadata", "cover-asset"].includes(variant))
      : [];
    passiveLibraryVariantIndex = 0;
    libraryPublicationDiagnostics.length = 0;
  },
  emitLibraryVariant(variant) {
    launcherStateRevision += 1;
    return publishLauncherFixture("direct-library-variant", {}, variant);
  },
  setManualConnectivityWeekStates(states) {
    const accepted = Array.isArray(states)
      ? states.filter((state) => ["active", "inactive", "closed", "unlinked", "unknown"].includes(state))
      : [];
    manualConnectivityWeekStates = accepted.length > 0 ? accepted : ["closed"];
    manualConnectivityWeekIndex = 0;
  },
  setManualConnectivityPublicationMode(mode) {
    manualConnectivityPublicationMode = mode === "expanded" ? "expanded" : "simple";
    manualConnectivityPublications = [];
  },
  setActivationPublicationMode(mode) {
    activationPublicationMode = mode === "revalidate" ? "revalidate" : "simple";
  },
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
  setCompetitionPreflightMode(mode) {
    competitionPreflightMode = ["active", "closed", "failure"].includes(mode) ? mode : "active";
  },
});
