const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  canonicalSessionPath,
  createAccountSessionRepository,
} = require("../src/account-session-repository");
const { readKnownAccounts } = require("../src/account-store");
const { readSessionRevision } = require("../src/session-revision-store");

const USERS = Object.freeze(["state-user-a", "state-user-b"]);
const REPORTABLE_SEEDS = Object.freeze([0x00c0ffee, 0x1badb002, 0x5eed1234]);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else files.push(fullPath);
    }
  }
  await visit(root);
  return files;
}

async function waitBounded(promise, label, timeoutMs = 1000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function machineConfig(root) {
  const userDataDir = path.join(root, "userData");
  return {
    sessionFileAbs: path.join(userDataDir, "session.json"),
    supabaseAnonKey: "state-machine-anon-key",
    supabaseUrl: "https://state-machine.supabase.co",
    userDataDir,
  };
}

function createMachine(root, seed) {
  const config = machineConfig(root);
  const nowMs = Date.parse("2026-07-18T12:00:00.000Z");
  const tokenSecrets = new Set();
  const repositories = [];
  const maximumRevision = new Map(USERS.map((userId) => [userId, 0]));
  let tokenSequence = 0;
  let repository;
  let blockingRefresh = null;
  let refreshMode = "success";

  function storedSession(userId, label, expiresAt = Math.floor(nowMs / 1000) + 3600) {
    tokenSequence += 1;
    const accessToken = `sm-${seed.toString(16)}-${tokenSequence}-${label}-access-secret`;
    const refreshToken = `sm-${seed.toString(16)}-${tokenSequence}-${label}-refresh-secret`;
    tokenSecrets.add(accessToken);
    tokenSecrets.add(refreshToken);
    return {
      schemaVersion: 1,
      session: {
        access_token: accessToken,
        expires_at: expiresAt,
        refresh_token: refreshToken,
        token_type: "bearer",
      },
      supabaseUrl: config.supabaseUrl,
      user: { email: `${userId}@example.test`, id: userId },
    };
  }

  function makeRepository() {
    const next = createAccountSessionRepository({
      config,
      isExpiringSoon: (value) => Number(value?.session?.expires_at) <= Math.floor(nowMs / 1000) + 60,
      now: () => nowMs,
      refreshBackoffScheduleMs: [10, 20],
      refreshProvider: async ({ userId }) => {
        if (refreshMode === "temporary") {
          throw Object.assign(new Error("deterministic temporary refresh failure"), {
            refreshReason: "provider-unavailable",
            sessionStatus: "temporary-failure",
            status: 503,
            transient: true,
          });
        }
        if (refreshMode === "blocking" && blockingRefresh?.userId === userId) {
          blockingRefresh.markStarted();
          return new Promise(() => {});
        }
        return storedSession(userId, "refreshed");
      },
    });
    repositories.push(next);
    return next;
  }

  repository = makeRepository();

  function armBlockingRefresh(userId) {
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    blockingRefresh = { markStarted, started, userId };
    refreshMode = "blocking";
    return started;
  }

  function clearBlockingRefresh() {
    blockingRefresh = null;
    refreshMode = "success";
  }

  return {
    config,
    get repository() { return repository; },
    set repository(value) { repository = value; },
    maximumRevision,
    nowMs,
    repositories,
    root,
    seed,
    sentinelContent: `unrelated-scoped-queue-sentinel:${seed.toString(16)}\n`,
    sentinelPath: path.join(config.userDataDir, "events", "players", "unrelated-player", "packs", "unrelated-pack", "pending", "sentinel.json"),
    storedSession,
    tokenSecrets,
    armBlockingRefresh,
    clearBlockingRefresh,
    makeRepository,
    setRefreshMode(mode) { refreshMode = mode; },
  };
}

function operation(name, run) {
  return Object.freeze({ name, run });
}

function loginOperation(userId, label, options = {}) {
  return operation(`login:${userId}:${label}`, async (machine) => {
    const result = await machine.repository.saveLogin(machine.storedSession(userId, label), {
      setActive: options.setActive !== false,
    });
    assert.equal(result.hasLocalSession, true);
    assert.equal(result.remoteUsable, true);
  });
}

function refreshSuccessOperation(userId, label) {
  return operation(`refresh-success:${userId}:${label}`, async (machine) => {
    await machine.repository.saveLogin(machine.storedSession(userId, `${label}-expired`, 1), { setActive: false });
    machine.setRefreshMode("success");
    const result = await machine.repository.resolve(userId, {
      bypassBackoff: true,
      connected: true,
      force: true,
    });
    assert.equal(result.status, "refreshed");
    assert.equal(result.remoteUsable, true);
  });
}

function refreshTemporaryOperation(userId, label) {
  return operation(`refresh-temporary:${userId}:${label}`, async (machine) => {
    await machine.repository.saveLogin(machine.storedSession(userId, `${label}-expired`, 1), { setActive: false });
    machine.setRefreshMode("temporary");
    const result = await machine.repository.resolve(userId, {
      bypassBackoff: true,
      connected: true,
      force: true,
    });
    machine.setRefreshMode("success");
    assert.equal(result.status, "deferred");
    assert.equal(result.hasLocalSession, true);
    assert.equal(result.remoteUsable, false);
    assert.equal(result.requiresLogin, false);
  });
}

function revokeOperation(userId) {
  return operation(`revoke:${userId}`, async (machine) => {
    const result = await machine.repository.markRevoked(userId, "state-machine-revoked");
    assert.equal(result.status, "revoked");
    assert.equal(result.remoteUsable, false);
  });
}

function logoutOperation(userId) {
  return operation(`logout:${userId}`, async (machine) => {
    const result = await machine.repository.remove(userId, { forgetAccount: false, reason: "state-machine-logout" });
    assert.equal(result.status, "missing");
    assert.equal(result.remoteUsable, false);
  });
}

function removeOperation(userId) {
  return operation(`remove:${userId}`, async (machine) => {
    const result = await machine.repository.remove(userId, { forgetAccount: true, reason: "state-machine-remove" });
    assert.equal(result.status, "missing");
    assert.equal(result.remoteUsable, false);
  });
}

function switchOperation(userId) {
  return operation(`switch:${userId}`, async (machine) => {
    const store = await machine.repository.setActive(userId);
    assert.equal(store.lastActiveUserId, userId);
  });
}

function restartOperation(label) {
  return operation(`repository-restart:${label}`, async (machine) => {
    machine.repository = machine.makeRepository();
    for (const userId of USERS) await machine.repository.read(userId);
  });
}

function cancelOperation(userId) {
  return operation(`cancel:${userId}`, async (machine) => {
    await machine.repository.saveLogin(machine.storedSession(userId, "before-cancel", 1), { setActive: false });
    const started = machine.armBlockingRefresh(userId);
    const pending = machine.repository.resolve(userId, { bypassBackoff: true, connected: true, force: true });
    await waitBounded(started, `blocking refresh for ${userId}`);
    machine.repository.cancelUserOperations(userId, "state-machine-cancel");
    const result = await waitBounded(pending, `cancelled refresh for ${userId}`);
    machine.clearBlockingRefresh();
    assert.ok(["stale", "cancelled"].includes(result.status));
    assert.equal(result.remoteUsable, false);
  });
}

function shutdownOperation(userId) {
  return operation(`shutdown-and-restart:${userId}`, async (machine) => {
    await machine.repository.saveLogin(machine.storedSession(userId, "before-shutdown", 1), { setActive: false });
    const started = machine.armBlockingRefresh(userId);
    const pending = machine.repository.resolve(userId, { bypassBackoff: true, connected: true, force: true });
    await waitBounded(started, `shutdown refresh for ${userId}`);
    const [refreshResult, shutdownResult] = await Promise.all([
      pending,
      machine.repository.shutdown({ reason: "state-machine-shutdown", timeoutMs: 250 }),
    ]);
    machine.clearBlockingRefresh();
    assert.equal(refreshResult.status, "cancelled");
    assert.equal(shutdownResult.drained, true);
    machine.repository = machine.makeRepository();
  });
}

function corruptOperation(userId) {
  return operation(`corrupt:${userId}`, async (machine) => {
    await fsp.writeFile(canonicalSessionPath(machine.config, userId), "{controlled-corruption", "utf8");
    const result = await machine.repository.read(userId);
    assert.equal(result.status, "corrupt");
    assert.equal(result.remoteUsable, false);
  });
}

function recoverOperation(userId) {
  return operation(`recover:${userId}`, async (machine) => {
    const result = await machine.repository.saveLogin(machine.storedSession(userId, "recovered"), { setActive: false });
    assert.equal(result.hasLocalSession, true);
    assert.equal(result.remoteUsable, true);
  });
}

async function assertMachineInvariants(machine, label) {
  const prefix = `seed=0x${machine.seed.toString(16)} after ${label}`;
  const accounts = await readKnownAccounts(machine.config);
  const accountIds = new Set(accounts.accounts.map((account) => account.userId));
  assert.ok(accounts.lastActiveUserId === null || accountIds.has(accounts.lastActiveUserId), `${prefix}: pointer must be null or reference an existing account`);

  for (const userId of USERS) {
    const ledger = await readSessionRevision(machine.config, userId);
    const previousRevision = machine.maximumRevision.get(userId) || 0;
    assert.notEqual(ledger.status, "corrupt", `${prefix}: revision ledger for ${userId} must remain readable`);
    assert.ok(ledger.lastRevision >= previousRevision, `${prefix}: revision for ${userId} decreased from ${previousRevision} to ${ledger.lastRevision}`);
    machine.maximumRevision.set(userId, ledger.lastRevision);

    const result = await machine.repository.read(userId);
    assert.equal(result.sessionRevision, ledger.lastRevision, `${prefix}: canonical result and ledger revision diverged for ${userId}`);
    const account = accounts.accounts.find((item) => item.userId === userId);
    if (account) {
      assert.ok(Number(account.sessionRevision) <= ledger.lastRevision, `${prefix}: metadata revision exceeds ledger for ${userId}`);
    }
    const expiresAt = Number(result.storedSession?.session?.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= Math.floor(machine.nowMs / 1000)) {
      assert.equal(result.remoteUsable, false, `${prefix}: expired ${userId} session became remoteUsable`);
    }
    if (result.status === "revoked" || account?.requiresLogin === true) {
      assert.equal(result.remoteUsable, false, `${prefix}: revoked ${userId} session became remoteUsable`);
    }
  }

  const files = await walkFiles(machine.config.userDataDir);
  const expectedCanonicalPaths = new Set(USERS.map((userId) => path.resolve(canonicalSessionPath(machine.config, userId)).toLowerCase()));
  const canonicalFiles = files.filter((filePath) => {
    const relative = path.relative(path.join(machine.config.userDataDir, "accounts", "sessions"), filePath);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  assert.equal(new Set(canonicalFiles.map((filePath) => path.resolve(filePath).toLowerCase())).size, canonicalFiles.length, `${prefix}: duplicate canonical paths found`);
  assert.ok(canonicalFiles.length <= USERS.length, `${prefix}: more than one canonical path per user`);
  for (const filePath of canonicalFiles) {
    assert.ok(expectedCanonicalPaths.has(path.resolve(filePath).toLowerCase()), `${prefix}: unexpected canonical path ${filePath}`);
  }

  const residue = files.filter((filePath) => filePath.endsWith(".tmp") || filePath.endsWith(".lock"));
  assert.deepEqual(residue, [], `${prefix}: temporary or lock residue remains`);

  for (const filePath of files) {
    const relative = path.relative(machine.config.userDataDir, filePath).replaceAll("\\", "/");
    if (relative.startsWith("accounts/sessions/")) continue;
    const raw = await fsp.readFile(filePath, "utf8");
    assert.doesNotMatch(raw, /"(?:access_token|refresh_token|provider_token)"\s*:/, `${prefix}: secret token field escaped into ${relative}`);
    for (const secret of machine.tokenSecrets) {
      assert.equal(raw.includes(secret), false, `${prefix}: token material escaped into ${relative}`);
    }
  }

  assert.equal(await fsp.readFile(machine.sentinelPath, "utf8"), machine.sentinelContent, `${prefix}: unrelated scoped queue changed`);
}

function sequenceForSeed(seed) {
  const random = mulberry32(seed);
  const a = USERS[0];
  const b = USERS[1];
  const scenarioGroups = [
    [refreshSuccessOperation(a, "mandatory")],
    [refreshTemporaryOperation(b, "mandatory")],
    [revokeOperation(a), loginOperation(a, "after-revoke", { setActive: false })],
    [logoutOperation(a), loginOperation(a, "after-logout", { setActive: false })],
    [removeOperation(b), loginOperation(b, "after-remove", { setActive: false })],
    [switchOperation(a), switchOperation(b)],
    [restartOperation("mandatory")],
    [cancelOperation(a)],
    [shutdownOperation(b)],
    [corruptOperation(a), recoverOperation(a)],
    [refreshSuccessOperation(random() < 0.5 ? a : b, "seeded-extra")],
    [refreshTemporaryOperation(random() < 0.5 ? a : b, "seeded-extra")],
    [switchOperation(random() < 0.5 ? a : b)],
    [restartOperation("seeded-extra")],
  ];
  return [
    loginOperation(a, "initial-a"),
    loginOperation(b, "initial-b", { setActive: false }),
    ...shuffle(scenarioGroups, random).flat(),
  ];
}

for (const seed of REPORTABLE_SEEDS) {
  test(`fixed-seed canonical session state machine seed=0x${seed.toString(16)}`, { timeout: 15000 }, async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), `hsl-session-state-machine-${seed.toString(16)}-`));
    const machine = createMachine(root, seed);
    const trace = [];
    try {
      await fsp.mkdir(path.dirname(machine.sentinelPath), { recursive: true });
      await fsp.writeFile(machine.sentinelPath, machine.sentinelContent, "utf8");
      await machine.repository.migrateLegacy();
      await assertMachineInvariants(machine, "migration-bootstrap");

      for (const next of sequenceForSeed(seed)) {
        trace.push(next.name);
        await next.run(machine);
        await assertMachineInvariants(machine, `step=${trace.length}:${next.name}; trace=${trace.join(" -> ")}`);
      }
    } finally {
      await Promise.allSettled(machine.repositories.map((repository) => repository.shutdown({ reason: "state-machine-cleanup", timeoutMs: 250 })));
      await fsp.rm(root, { force: true, recursive: true });
    }
  });
}
