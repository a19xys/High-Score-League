const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createSessionResult } = require("../src/session-result");
const { readKnownAccounts, rememberAccount, toSafeAccountsState } = require("../src/account-store");
const {
  createAccountProfileSync,
  detectImage,
  safeLegacyAvatarUrl,
  validateStoragePath,
} = require("../src/account-profile-sync");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const USER_D = "44444444-4444-4444-8444-444444444444";
const AVATAR_A = `avatars/${USER_A}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;

async function withTempDir(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-profile-sync-"));
  try { return await fn(root); } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

function webp() {
  return Buffer.from("524946460400000057454250", "hex");
}

function response(body, options = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const headers = new Headers(options.headers || {});
  return {
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    headers,
    status: options.status || 200,
    text: async () => buffer.toString("utf8"),
  };
}

function validSession(userId = USER_A) {
  return createSessionResult({
    sessionRevision: 1,
    status: "valid",
    storedSession: { session: { access_token: "secret-token" }, user: { id: userId } },
  });
}

async function fixture(root, rows, options = {}) {
  const config = { supabaseAnonKey: "anon-key", supabaseUrl: "https://project.example", userDataDir: path.join(root, "userData") };
  await rememberAccount(config, { email: "one@example.test", userId: USER_A });
  if (options.twoAccounts) await rememberAccount(config, { email: "two@example.test", userId: USER_B }, { setActive: false });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ init, url: String(url) });
    if (String(url).includes("/rest/v1/profiles")) return response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    if (options.failDownload) throw Object.assign(new Error("network"), { code: "ECONNRESET" });
    return response(options.avatar || webp(), { headers: { "content-type": options.contentType || "image/webp" } });
  };
  let changed = 0;
  const sync = createAccountProfileSync({
    config,
    fetchImpl,
    getConnectivityState: () => ({ reachability: options.offline ? "offline" : "connected" }),
    onChanged: async () => { changed += 1; },
    resolveSessionResultImpl: async () => options.noSession ? createSessionResult({ status: "missing" }) : validSession(),
  });
  return { calls, changed: () => changed, config, sync };
}

test("valida la identidad storage y rechaza destinos legacy inseguros", () => {
  assert.equal(validateStoragePath(AVATAR_A, USER_A), true);
  assert.equal(validateStoragePath(`avatars/${USER_B}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`, USER_A), false);
  assert.equal(validateStoragePath(`avatars/${USER_A}/avatar.png`, USER_A), false);
  assert.equal(safeLegacyAvatarUrl("https://cdn.example/avatar.png").hostname, "cdn.example");
  assert.equal(safeLegacyAvatarUrl("http://127.0.0.1/avatar.png"), null);
  assert.equal(safeLegacyAvatarUrl("https://user:pass@cdn.example/avatar.png"), null);
  assert.equal(detectImage(webp(), "image/webp").extension, "webp");
});

test("consulta todos los perfiles en un batch y storage prevalece sobre avatar_url", async () => withTempDir(async (root) => {
  const ctx = await fixture(root, [
    { id: USER_A, initials: "AA", username: "alpha", avatar_storage_path: AVATAR_A, avatar_url: "https://legacy.example/a.png" },
    { id: USER_B, initials: "BB", username: "beta", avatar_storage_path: null, avatar_url: null },
  ], { twoAccounts: true });
  const result = await ctx.sync.request("login", { force: true });
  const store = await readKnownAccounts(ctx.config);
  assert.equal(result.attempted, true);
  assert.equal(ctx.calls.filter((call) => call.url.includes("/rest/v1/profiles")).length, 1);
  assert.match(ctx.calls[0].url, /id=in\./);
  assert.equal(ctx.calls.some((call) => call.url === "https://legacy.example/a.png"), false);
  const account = store.accounts.find((item) => item.userId === USER_A);
  assert.equal(account.avatarStoragePath, AVATAR_A);
  assert.equal(account.avatarUrl, null);
  assert.equal(account.initials, "AA");
  assert.equal(account.username, "alpha");
  assert.ok(account.avatarCachePath);
  assert.equal(ctx.changed(), 1);
}));

test("avatar storage sin cambios y fichero existente no vuelve a descargarse", async () => withTempDir(async (root) => {
  const rows = [{ id: USER_A, initials: "AA", avatar_storage_path: AVATAR_A, avatar_url: null }];
  const ctx = await fixture(root, rows);
  await ctx.sync.request("first", { force: true });
  const downloads = () => ctx.calls.filter((call) => call.url.includes("/storage/v1/object/public/")).length;
  assert.equal(downloads(), 1);
  await ctx.sync.request("second", { force: true });
  assert.equal(downloads(), 1);
  assert.equal(ctx.sync.getDiagnostics().unchanged, 1);
}));

test("login forzado incorpora D dentro de freshness sin redescargar A/B/C", async () => withTempDir(async (root) => {
  const config = { supabaseAnonKey: "anon", supabaseUrl: "https://project.example", userDataDir: path.join(root, "post-login") };
  const users = [USER_A, USER_B, USER_C];
  for (const [index, userId] of users.entries()) {
    await rememberAccount(config, { email: `cached-${index}@example.test`, userId }, { setActive: index === 0 });
  }
  let rows = users.map((id, index) => ({
    avatar_storage_path: `avatars/${id}/${String(index + 1).repeat(8)}-${String(index + 1).repeat(4)}-4${String(index + 1).repeat(3)}-8${String(index + 1).repeat(3)}-${String(index + 1).repeat(12)}.webp`,
    id,
    initials: `C${index}`,
  }));
  const calls = [];
  const sync = createAccountProfileSync({
    config,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return String(url).includes("/rest/v1/profiles")
        ? response(JSON.stringify(rows), { headers: { "content-type": "application/json" } })
        : response(webp(), { headers: { "content-type": "image/webp" } });
    },
    getConnectivityState: () => ({ reachability: "connected" }),
    resolveSessionResultImpl: async () => validSession(USER_D),
  });
  await sync.request("startup", { force: true });
  const downloads = () => calls.filter((url) => url.includes("/storage/v1/object/public/")).length;
  assert.equal(downloads(), 3);
  assert.equal((await sync.request("startup-again")).reason, "fresh");

  await rememberAccount(config, { email: "new-d@example.test", userId: USER_D });
  const avatarD = `avatars/${USER_D}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp`;
  rows = [...rows, { avatar_storage_path: avatarD, id: USER_D, initials: "ND" }];
  const result = await sync.request("login", { force: true });
  const store = await readKnownAccounts(config);
  const safe = toSafeAccountsState(store, { hasSession: true }, { userDataDir: config.userDataDir });
  const accountD = store.accounts.find((account) => account.userId === USER_D);
  const projectedD = safe.knownAccounts.find((account) => account.userId === USER_D);
  assert.equal(result.attempted, true);
  assert.equal(calls.filter((url) => url.includes("/rest/v1/profiles")).length, 2);
  assert.equal(downloads(), 4);
  assert.equal(accountD.avatarStoragePath, avatarD);
  assert.equal((await fsp.stat(path.dirname(path.resolve(config.userDataDir, accountD.avatarCachePath)))).isDirectory(), true);
  assert.match(projectedD.avatarLocalUrl, /^file:\/\/\//);
}));

test("cambio de avatar promueve el nuevo antes de eliminar el anterior", async () => withTempDir(async (root) => {
  const first = await fixture(root, [{ id: USER_A, initials: "AA", avatar_storage_path: AVATAR_A }]);
  await first.sync.request("first", { force: true });
  const old = (await readKnownAccounts(first.config)).accounts[0].avatarCachePath;
  const nextPath = `avatars/${USER_A}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp`;
  const second = createAccountProfileSync({
    config: first.config,
    fetchImpl: async (url) => String(url).includes("/rest/v1/profiles")
      ? response(JSON.stringify([{ id: USER_A, initials: "AB", avatar_storage_path: nextPath }]))
      : response(webp(), { headers: { "content-type": "image/webp" } }),
    getConnectivityState: () => ({ reachability: "connected" }),
    resolveSessionResultImpl: async () => validSession(),
  });
  await second.request("changed", { force: true });
  const account = (await readKnownAccounts(first.config)).accounts[0];
  assert.notEqual(account.avatarCachePath, old);
  await assert.rejects(fsp.stat(path.resolve(first.config.userDataDir, old)), /ENOENT/);
  assert.equal((await fsp.stat(path.resolve(first.config.userDataDir, account.avatarCachePath))).isFile(), true);
}));

test("fallo de descarga conserva metadatos y fichero anteriores", async () => withTempDir(async (root) => {
  const initial = await fixture(root, [{ id: USER_A, initials: "AA", avatar_storage_path: AVATAR_A }]);
  await initial.sync.request("first", { force: true });
  const before = (await readKnownAccounts(initial.config)).accounts[0];
  const failing = await fixture(root, [{
    id: USER_A, initials: "AX", avatar_storage_path: `avatars/${USER_A}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp`,
  }], { failDownload: true });
  await failing.sync.request("failed", { force: true });
  const after = (await readKnownAccounts(initial.config)).accounts[0];
  assert.equal(after.avatarCachePath, before.avatarCachePath);
  assert.equal(after.avatarStoragePath, before.avatarStoragePath);
  assert.equal(after.initials, "AX");
  assert.equal((await fsp.stat(path.resolve(initial.config.userDataDir, before.avatarCachePath))).isFile(), true);
}));

test("borrado remoto limpia metadata y cache; perfil invalido preserva avatar", async () => withTempDir(async (root) => {
  const initial = await fixture(root, [{ id: USER_A, initials: "AA", avatar_storage_path: AVATAR_A }]);
  await initial.sync.request("first", { force: true });
  const cached = (await readKnownAccounts(initial.config)).accounts[0].avatarCachePath;
  const deleted = await fixture(root, [{ id: USER_A, initials: null, avatar_storage_path: null, avatar_url: null }]);
  await deleted.sync.request("delete", { force: true });
  const cleared = (await readKnownAccounts(initial.config)).accounts[0];
  assert.equal(cleared.avatarCachePath, null);
  assert.equal(cleared.initials, "AA");
  await assert.rejects(fsp.stat(path.resolve(initial.config.userDataDir, cached)), /ENOENT/);

  const restored = await fixture(root, [{ id: USER_A, initials: "AA", avatar_storage_path: AVATAR_A }]);
  await restored.sync.request("restore", { force: true });
  const valid = (await readKnownAccounts(initial.config)).accounts[0];
  const invalid = await fixture(root, [{ id: USER_A, initials: "ZZ", avatar_storage_path: `avatars/${USER_B}/bad.webp` }]);
  await invalid.sync.request("invalid", { force: true });
  const preserved = (await readKnownAccounts(initial.config)).accounts[0];
  assert.equal(preserved.avatarCachePath, valid.avatarCachePath);
  assert.equal(preserved.initials, "ZZ");
}));

test("perfil sin initials remotas conserva o deriva un fallback local seguro", async () => withTempDir(async (root) => {
  const ctx = await fixture(root, [{ id: USER_A, initials: null, avatar_storage_path: null, avatar_url: null }]);
  await ctx.sync.request("login", { force: true });
  const account = (await readKnownAccounts(ctx.config)).accounts[0];
  assert.equal(account.initials, "OE");
  assert.notEqual(account.initials, "null");
}));

test("offline y ausencia de sesion no hacen red; runs concurrentes se deduplican", async () => withTempDir(async (root) => {
  const offline = await fixture(root, [], { offline: true });
  assert.equal((await offline.sync.request("offline")).reason, "offline");
  assert.equal(offline.calls.length, 0);
  const missing = await fixture(root, [], { noSession: true });
  assert.equal((await missing.sync.request("missing", { force: true })).reason, "no-session");
  assert.equal(missing.calls.length, 0);

  let release;
  let queries = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const config = { supabaseAnonKey: "anon", supabaseUrl: "https://project.example", userDataDir: path.join(root, "dedupe") };
  await rememberAccount(config, { userId: USER_A });
  const sync = createAccountProfileSync({
    config,
    fetchImpl: async () => { queries += 1; await gate; return response("[]"); },
    getConnectivityState: () => ({ reachability: "connected" }),
    resolveSessionResultImpl: async () => validSession(),
  });
  const one = sync.request("one", { force: true });
  const two = sync.request("two", { force: true });
  assert.equal(one, two);
  release();
  await one;
  assert.equal(queries, 1);
}));

test("login offline sigue siendo seguro y el evento connected sincroniza después", async () => withTempDir(async (root) => {
  let reachability = "offline";
  const config = { supabaseAnonKey: "anon", supabaseUrl: "https://project.example", userDataDir: path.join(root, "offline-login") };
  await rememberAccount(config, { email: "offline@example.test", userId: USER_A });
  const calls = [];
  const sync = createAccountProfileSync({
    config,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return response(JSON.stringify([{ id: USER_A, initials: "ON", avatar_storage_path: null, avatar_url: null }]), {
        headers: { "content-type": "application/json" },
      });
    },
    getConnectivityState: () => ({ reachability }),
    resolveSessionResultImpl: async () => validSession(),
  });
  assert.equal((await sync.request("login", { force: true })).reason, "offline");
  assert.equal(calls.length, 0);
  reachability = "connected";
  assert.equal((await sync.request("connectivity-restored")).attempted, true);
  assert.equal(calls.filter((url) => url.includes("/rest/v1/profiles")).length, 1);
  assert.equal((await readKnownAccounts(config)).accounts[0].initials, "ON");
}));

test("legacy HTTP(S) se descarga solo a cache local y olvidar limpia solo su directorio", async () => withTempDir(async (root) => {
  const ctx = await fixture(root, [{ id: USER_A, initials: "AA", avatar_url: "https://cdn.example/a.png" }], {
    avatar: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    contentType: "image/png",
  });
  await ctx.sync.request("legacy", { force: true });
  const account = (await readKnownAccounts(ctx.config)).accounts[0];
  assert.equal(account.avatarStoragePath, null);
  assert.equal(account.avatarUrl, "https://cdn.example/a.png");
  const directory = path.dirname(path.resolve(ctx.config.userDataDir, account.avatarCachePath));
  await ctx.sync.forget(USER_A);
  await assert.rejects(fsp.stat(directory), /ENOENT/);
}));

test("cancelar un run activo no publica metadata ni deja la promesa huerfana", async () => withTempDir(async (root) => {
  const config = { supabaseAnonKey: "anon", supabaseUrl: "https://project.example", userDataDir: path.join(root, "cancel") };
  await rememberAccount(config, { initials: "AA", userId: USER_A });
  let requested = false;
  let ready = false;
  let queries = 0;
  const sync = createAccountProfileSync({
    config,
    fetchImpl: async (_url, init) => {
      queries += 1;
      requested = true;
      if (ready) return response("[]", { headers: { "content-type": "application/json" } });
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true }));
    },
    getConnectivityState: () => ({ reachability: "connected" }),
    resolveSessionResultImpl: async () => validSession(),
  });
  const pending = sync.request("startup", { force: true });
  while (!requested) await new Promise((resolve) => setImmediate(resolve));
  sync.cancel("suspend");
  const result = await pending;
  assert.equal(result.cancelled, true);
  assert.equal((await readKnownAccounts(config)).accounts[0].initials, "AA");
  assert.equal(sync.getDiagnostics().inFlight, false);
  ready = true;
  const switched = await sync.request("switch-account", { force: true });
  assert.equal(switched.attempted, true);
  assert.equal(switched.cancelled, undefined);
  assert.equal(queries, 2);
}));
