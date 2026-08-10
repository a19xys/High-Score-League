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

const titles = [
  "SPACE INVADERS Y EL TEMPLO DEL MALO MALOSO",
  "PAC MAN",
  "GALAGA",
  "DONKEY KONG",
];

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
  const accounts = [
    { displayName: "Fixture", email: "fixture@example.test", hasLocalSession: true, isActive: activeUserId === "fixture", userId: "fixture" },
    { displayName: "Cuenta disponible", email: "valid@example.test", hasLocalSession: true, isActive: activeUserId === "valid", userId: "valid" },
    { displayName: "Cuenta caducada inesperadamente", email: "expired@example.test", hasLocalSession: true, isActive: false, userId: "expired" },
    { displayName: "Cuenta bloqueada", email: "relogin@example.test", hasLocalSession: false, isActive: false, requiresLogin: true, userId: "relogin" },
  ];
  const heroChecking = heroStatus === "checking";
  const heroError = heroStatus === "error";
  return {
    launcherStateRevision,
    accounts: { activeUserId, knownAccounts: accounts },
    autoSync: { status: "idle" },
    bridge: {},
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
    },
    library: {
      directory: { available: true, configured: true, path: "C:/fixture-packs" },
      packs: packs.map((libraryPack) => ({ ...libraryPack })),
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
    membership: heroChecking
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
      : { canPlayCompetition: true, status: "member" },
    notices: [],
    queue: { totals: { failed: 0, pending: 0, sent: 0 } },
    readiness: {
      canPlayCompetition: !heroError && !heroChecking,
      canPractice: !heroError,
      blockers: heroChecking ? ["Comprobando participaciÃ³n."] : [],
      checks: heroError ? [{ id: "rom", level: "error" }] : [],
      status: heroError ? "error" : heroChecking ? "blocked" : "ready",
    },
    remoteConfiguration: { status: "configured" },
    selection: { activeInstanceKey: pack.instanceKey },
    session: {
      email: activeUserId === "valid" ? "valid@example.test" : "fixture@example.test",
      hasSession: true,
      userId: activeUserId,
    },
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
