const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { readKnownAccounts } = require("../src/account-store");
const {
  canonicalSessionPath,
  createAccountSessionRepository,
  migrationLockPath,
  sessionLockPath,
} = require("../src/account-session-repository");
const { loadConfig } = require("../src/config");
const { describeHslUserDataIsolation, resolveHslUserDataDir } = require("../src/hsl-user-data-root");
const { configureProductRuntime } = require("../src/product-runtime");
const { readSessionRevision } = require("../src/session-revision-store");
const {
  configureSessionProtection,
  getSessionStorageDiagnostics,
  readStoredSession,
  writeStoredSession,
} = require("../src/secure-session-storage");

const HSL_OWNED_ROOTS = [
  "accounts",
  "competitive-authority",
  "diagnostics",
  "events",
  "hsl",
  "libraries",
  "library",
  "packs",
  "players",
  "presence",
  "runtime",
];

async function snapshotOwnedState(root) {
  const hash = crypto.createHash("sha256");
  let fileCount = 0;
  async function visit(target, relative) {
    let entries;
    try {
      entries = await fsp.readdir(target, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(target, entry.name);
      const childRelative = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isFile()) {
        const bytes = await fsp.readFile(child);
        hash.update(childRelative.replaceAll("\\", "/"));
        hash.update("\0");
        hash.update(bytes);
        hash.update("\0");
        fileCount += 1;
      }
    }
  }
  for (const name of HSL_OWNED_ROOTS) await visit(path.join(root, name), name);
  return { digest: hash.digest("hex"), fileCount };
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

app.setName("High Score League");
app.disableHardwareAcceleration();

const reportPath = process.env.HSL_AUTH_ISOLATION_PROBE_REPORT;
const electronUserDataDir = path.resolve(app.getPath("userData"));
const hslUserDataDir = resolveHslUserDataDir(electronUserDataDir);
const appRoot = path.resolve(__dirname, "..");

if (!reportPath || !process.env.HSL_USER_DATA_DIR) {
  process.stderr.write("Faltan rutas del probe de aislamiento.\n");
  process.exit(2);
}

configureProductRuntime({
  appPath: appRoot,
  isPackaged: false,
  productName: app.getName(),
  resourcesPath: process.resourcesPath,
  userDataDir: hslUserDataDir,
  version: "0.3.1",
});

app.whenReady().then(async () => {
  let repository;
  try {
    const normalBefore = await snapshotOwnedState(electronUserDataDir);
    const config = loadConfig(path.join(hslUserDataDir, "missing-config.json"), appRoot, {
      environment: process.env,
      productRuntime: {
        isPackaged: false,
        productConfig: null,
        resourcesPath: process.resourcesPath,
        userDataDir: hslUserDataDir,
        version: "0.3.1",
      },
    });
    const isolation = describeHslUserDataIsolation(electronUserDataDir, hslUserDataDir);
    if (!safeStorage.isEncryptionAvailable()) {
      throw Object.assign(new Error("safeStorage no está disponible."), { code: "SESSION_STORAGE_UNAVAILABLE" });
    }
    const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend?.() || "unknown" : process.platform;
    configureSessionProtection({
      degraded: backend === "basic_text",
      encryptionAvailable: backend !== "basic_text",
      provider: `electron-${backend}`,
      decryptString(value) {
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      },
      encryptString(value) {
        return safeStorage.encryptString(value).toString("base64");
      },
    });

    const roundTripMarker = `hsl-safe-storage-probe-${crypto.randomUUID()}`;
    const encryptedMarker = safeStorage.encryptString(roundTripMarker);
    const safeStorageRoundTrip = safeStorage.decryptString(encryptedMarker) === roundTripMarker;
    const syntheticUserId = `synthetic-user-${crypto.randomUUID()}`;
    const accessToken = `synthetic-access-${crypto.randomUUID()}`;
    const refreshToken = `synthetic-refresh-${crypto.randomUUID()}`;
    const storedSession = {
      schemaVersion: 3,
      session: {
        access_token: accessToken,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        refresh_token: refreshToken,
        token_type: "bearer",
      },
      sessionRevision: 1,
      supabaseUrl: "https://synthetic-probe.supabase.co",
      user: { email: "synthetic-probe@example.invalid", id: syntheticUserId },
    };
    const directEnvelopePath = path.join(hslUserDataDir, "probe", "direct-session.json");
    await writeStoredSession(directEnvelopePath, storedSession, {
      expectedRevision: 0,
      expectedUserId: syntheticUserId,
      revision: 1,
    });
    const directRead = await readStoredSession(directEnvelopePath, { migrate: false });

    const repositoryConfig = {
      ...config,
      sessionFileAbs: path.join(hslUserDataDir, "session.json"),
      supabaseUrl: storedSession.supabaseUrl,
      userDataDir: hslUserDataDir,
    };
    repository = createAccountSessionRepository({ config: repositoryConfig });
    const migration = await repository.migrateLegacy();
    const saved = await repository.saveLogin(storedSession);
    const canonicalPath = canonicalSessionPath(repositoryConfig, syntheticUserId);
    const [canonicalRaw, directRaw, knownAccounts, ledger, canonicalRead] = await Promise.all([
      fsp.readFile(canonicalPath, "utf8"),
      fsp.readFile(directEnvelopePath, "utf8"),
      readKnownAccounts(repositoryConfig),
      readSessionRevision(repositoryConfig, syntheticUserId),
      readStoredSession(canonicalPath, { migrate: false }),
    ]);
    const sensitiveNeedles = [accessToken, refreshToken, roundTripMarker];
    const serializedEnvelopes = `${canonicalRaw}\n${directRaw}`;
    const generatedPaths = [
      canonicalPath,
      directEnvelopePath,
      knownAccounts.filePath,
      ledger.filePath,
    ].filter(Boolean);
    const locksReleased = !fs.existsSync(sessionLockPath(repositoryConfig, syntheticUserId))
      && !fs.existsSync(migrationLockPath(repositoryConfig));
    const normalAfter = await snapshotOwnedState(electronUserDataDir);
    const diagnostics = getSessionStorageDiagnostics();
    const report = {
      configUsesHslRoot: path.resolve(config.userDataDir) === hslUserDataDir,
      directStorage: {
        identityMatches: directRead.storedSession?.user?.id === syntheticUserId,
        revision: directRead.revision,
        status: directRead.status,
      },
      electronUserDataBasename: path.basename(electronUserDataDir),
      fixtureRootsContained: generatedPaths.every((target) => isInside(hslUserDataDir, target)),
      hslUserDataBasename: path.basename(hslUserDataDir),
      isolation,
      migrationStatus: migration?.status || null,
      noSyntheticSecretsInEnvelopes: sensitiveNeedles.every((value) => !serializedEnvelopes.includes(value)),
      normalHslState: {
        afterDigest: normalAfter.digest,
        beforeDigest: normalBefore.digest,
        fileCount: normalAfter.fileCount,
        unchanged: normalBefore.digest === normalAfter.digest && normalBefore.fileCount === normalAfter.fileCount,
      },
      repository: {
        activeAccountMatches: knownAccounts.lastActiveUserId === syntheticUserId,
        canonicalIdentityMatches: canonicalRead.storedSession?.user?.id === syntheticUserId,
        knownAccountPresent: knownAccounts.accounts.some((account) => account.userId === syntheticUserId),
        locksReleased,
        revision: saved.sessionRevision,
        revisionCommitted: ledger.committed === true && ledger.lastRevision === saved.sessionRevision,
      },
      safeStorageRoundTrip,
      storage: {
        encryptionAvailable: diagnostics.encryptionAvailable === true,
        provider: diagnostics.provider,
        warning: diagnostics.warning,
      },
    };
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
    process.stdout.write("HSL auth isolation probe complete.\n");
    await repository.shutdown({ reason: "probe-complete", timeoutMs: 3000 });
    app.quit();
  } catch (error) {
    await repository?.shutdown({ reason: "probe-error", timeoutMs: 3000 }).catch(() => {});
    await fsp.mkdir(path.dirname(reportPath), { recursive: true }).catch(() => {});
    await fsp.writeFile(reportPath, JSON.stringify({
      code: typeof error?.code === "string" ? error.code : "PROBE_FAILED",
      message: String(error?.message || "Probe failed").slice(0, 300),
      ok: false,
    }, null, 2), "utf8").catch(() => {});
    app.exit(1);
  }
});
