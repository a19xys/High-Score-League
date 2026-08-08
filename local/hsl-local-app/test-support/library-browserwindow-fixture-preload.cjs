const { contextBridge } = require("electron");

let activeIndex = 0;
let expanded = true;
let launcherStateRevision = 1;
let launcherStateListener = null;

const titles = [
  "SPACE INVADERS Y EL TEMPLO DEL MALO MALOSO",
  "PAC MAN",
  "GALAGA",
  "DONKEY KONG",
];

const packs = Array.from({ length: 40 }, (_, index) => ({
  deprecated: index % 10 === 1,
  favorite: index % 3 === 0,
  favoriteKey: `pack-${index}`,
  id: `pack-${index}`,
  instanceKey: `instance-${index}`,
  seasonId: `season-${Math.floor(index / 10)}`,
  seasonName: `Temporada ${Math.floor(index / 10) + 1}`,
  status: index % 10 === 3 ? "error" : index % 10 === 2 ? "warning" : "ok",
  subtitle: `Semana ${index + 1}`,
  title: `${titles[index % titles.length]} ${index + 1}`,
  weekId: `week-${index}`,
  weekNumber: index + 1,
  year: String(1980 + index),
}));

function visiblePacks() {
  return packs.map((pack, index) => expanded && index < 3
    ? { ...pack, title: `${pack.title} REFRESH EXPANSION` }
    : { ...pack });
}

function snapshot({ samePack = false } = {}) {
  const pack = packs[activeIndex];
  return {
    launcherStateRevision,
    accounts: { knownAccounts: [] },
    autoSync: { status: "idle" },
    bridge: {},
    game: {
      displayName: `${pack.title}${expanded ? " REFRESH" : ""}${samePack ? " SAME" : ""}`,
      id: pack.id,
      instanceKey: pack.instanceKey,
      manual: { available: true },
      packId: pack.id,
      weekId: pack.weekId,
      year: pack.year,
    },
    library: {
      directory: { available: true, configured: true, path: "C:/fixture-packs" },
      packs: visiblePacks(),
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
    membership: { canPlayCompetition: true, status: "member" },
    notices: [],
    queue: { totals: { failed: 0, pending: 0, sent: 0 } },
    readiness: { canPlayCompetition: true, canPractice: true, status: "ready" },
    remoteConfiguration: { status: "configured" },
    selection: { activeInstanceKey: pack.instanceKey },
    session: { email: "fixture@example.test", hasSession: true, userId: "fixture" },
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
    displayStatus: "connected",
    probe: { inFlight: false, phase: "idle" },
    reachability: "connected",
    reachabilityGeneration: 1,
  }),
  getInitialState: async () => snapshot(),
  getRankingCapabilitiesState: async () => ({ entries: {}, generation: 1, inFlight: false }),
  getState: async () => {
    await new Promise((resolve) => setTimeout(resolve, 24));
    expanded = true;
    launcherStateRevision += 1;
    return snapshot();
  },
  onBusyPhase: () => () => {},
  onConnectivityState: () => () => {},
  onLauncherState: subscription((callback) => { launcherStateListener = callback; }),
  onRankingCapabilitiesState: () => () => {},
  reportConnectivityApplied() {},
  reportRankingApplied() {},
  reportStartupMilestone() {},
  requestConnectivityRefresh: async () => ({ reachability: "connected", reachabilityGeneration: 1 }),
  resolveThemeBootstrap: () => ({ effectiveTheme: "dark", mode: "manual" }),
  setLibraryPreferences: async () => ({ ok: true }),
  setTheme: async (theme) => ({ effectiveTheme: theme === "light" ? "light" : "dark", ok: true }),
  startupTheme: Object.freeze({ effectiveTheme: "dark", legacyThemeMigrationAllowed: false }),
  toggleLibraryFavorite: async () => ({ ok: true }),
  useLibraryPack: async (packId) => {
    await new Promise((resolve) => setTimeout(resolve, 28));
    activeIndex = packs.findIndex((pack) => pack.id === packId);
    expanded = false;
    launcherStateRevision += 1;
    return { ok: true, pack: packs[activeIndex], state: snapshot() };
  },
});

contextBridge.exposeInMainWorld("hslFixture", {
  emitSamePackSnapshot() {
    launcherStateRevision += 1;
    launcherStateListener?.(snapshot({ samePack: true }));
  },
});
