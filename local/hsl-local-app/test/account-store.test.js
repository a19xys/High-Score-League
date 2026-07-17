const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  clearActiveAccount,
  getKnownAccountsPath,
  readKnownAccounts,
  rememberAccount,
  rememberSessionAccount,
  removeKnownAccount,
  safeInitials,
  toSafeAccountsState,
} = require("../src/account-store");

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-account-store-test-"));

  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

function config(root) {
  return {
    userDataDir: path.join(root, "userData"),
  };
}

test("archivo ausente devuelve lista vacia", async () => {
  await withTempDir(async (dir) => {
    const store = await readKnownAccounts(config(dir));

    assert.equal(store.accounts.length, 0);
    assert.equal(store.lastActiveUserId, null);
    assert.equal(store.filePath, getKnownAccountsPath(config(dir)));
  });
});

test("JSON corrupto no crashea y devuelve warning", async () => {
  await withTempDir(async (dir) => {
    const cfg = config(dir);
    const filePath = getKnownAccountsPath(cfg);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, "{no-json", "utf8");

    const store = await readKnownAccounts(cfg);

    assert.equal(store.accounts.length, 0);
    assert.equal(store.warnings.length, 1);
  });
});

test("anadir cuenta crea archivo y no guarda tokens", async () => {
  await withTempDir(async (dir) => {
    const cfg = config(dir);

    await rememberAccount(cfg, {
      access_token: "secret-access-token",
      email: "player@example.com",
      refresh_token: "secret-refresh-token",
      session: { access_token: "nested-secret" },
      userId: "user-1",
    }, {
      now: "2026-06-19T00:00:00.000Z",
    });

    const raw = await fsp.readFile(getKnownAccountsPath(cfg), "utf8");
    const store = JSON.parse(raw);

    assert.equal(store.accounts.length, 1);
    assert.equal(store.accounts[0].email, "player@example.com");
    assert.equal(store.lastActiveUserId, "user-1");
    assert.equal(raw.includes("secret-access-token"), false);
    assert.equal(raw.includes("secret-refresh-token"), false);
    assert.equal(raw.includes("nested-secret"), false);
  });
});

test("anadir la misma cuenta actualiza lastUsedAt sin duplicar", async () => {
  await withTempDir(async (dir) => {
    const cfg = config(dir);

    await rememberAccount(cfg, {
      email: "player@example.com",
      userId: "user-1",
    }, {
      now: "2026-06-19T00:00:00.000Z",
    });
    await rememberAccount(cfg, {
      displayName: "Player One",
      email: "player@example.com",
      userId: "user-1",
    }, {
      now: "2026-06-20T00:00:00.000Z",
    });

    const store = await readKnownAccounts(cfg);

    assert.equal(store.accounts.length, 1);
    assert.equal(store.accounts[0].displayName, "Player One");
    assert.equal(store.accounts[0].addedAt, "2026-06-19T00:00:00.000Z");
    assert.equal(store.accounts[0].lastUsedAt, "2026-06-20T00:00:00.000Z");
  });
});

test("rememberSessionAccount expone cuenta segura sin tokens", async () => {
  await withTempDir(async (dir) => {
    const cfg = config(dir);

    await rememberAccount(cfg, {
      email: "player@example.com",
      userId: "user-1",
    });
    await rememberSessionAccount(cfg, {
      email: "player@example.com",
      hasSession: true,
      userId: "user-1",
    }, {
      now: "2026-06-19T00:00:00.000Z",
    });

    const state = toSafeAccountsState(await readKnownAccounts(cfg), {
      email: "player@example.com",
      hasSession: true,
      userId: "user-1",
    });

    assert.equal(state.activeUserId, "user-1");
    assert.equal(state.knownAccounts[0].isActive, true);
    assert.equal(JSON.stringify(state).includes("access_token"), false);
    assert.equal(JSON.stringify(state).includes("refresh_token"), false);
  });
});

test("estado renderer solo pide login para fallos concluyentes con pendientes", () => {
  const store = {
    accounts: [{ email: "player@example.com", userId: "user-1" }],
    lastActiveUserId: null,
    warnings: [],
  };
  const temporary = toSafeAccountsState(store, {}, {
    sessionStatuses: new Map([["user-1", { pendingCount: 1, status: "deferred-offline" }]]),
  });
  const revokedWithoutPending = toSafeAccountsState(store, {}, {
    sessionStatuses: new Map([["user-1", { pendingCount: 0, status: "revoked" }]]),
  });
  const revoked = toSafeAccountsState(store, {}, {
    sessionStatuses: new Map([["user-1", { pendingCount: 1, status: "revoked" }]]),
  });

  assert.equal(temporary.knownAccounts[0].requiresLogin, false);
  assert.equal(revokedWithoutPending.knownAccounts[0].requiresLogin, false);
  assert.equal(revoked.knownAccounts[0].requiresLogin, true);
  assert.match(revoked.knownAccounts[0].requiresLoginMessage, /puntuaciones pendientes/);
  assert.equal(JSON.stringify(revoked).includes("token"), false);
});

test("quitar cuenta recordada no toca colas locales", async () => {
  await withTempDir(async (dir) => {
    const cfg = config(dir);
    const queueFile = path.join(cfg.userDataDir, "players", "user_user-1", "packs", "pack-1", "events", "pending", "score.json");
    await fsp.mkdir(path.dirname(queueFile), { recursive: true });
    await fsp.writeFile(queueFile, "score", "utf8");
    await rememberAccount(cfg, {
      email: "player@example.com",
      userId: "user-1",
    });

    const result = await removeKnownAccount(cfg, "user-1");

    assert.equal(result.removed, true);
    assert.equal(await fsp.readFile(queueFile, "utf8"), "score");
  });
});

test("clearActiveAccount conserva cuentas conocidas", async () => {
  await withTempDir(async (dir) => {
    const cfg = config(dir);
    await rememberAccount(cfg, {
      email: "player@example.com",
      userId: "user-1",
    });

    const store = await clearActiveAccount(cfg);

    assert.equal(store.accounts.length, 1);
    assert.equal(store.lastActiveUserId, null);
  });
});

test("safeInitials genera siglas estables", () => {
  assert.equal(safeInitials("player@example.com"), "PE");
  assert.equal(safeInitials(""), "J");
});
