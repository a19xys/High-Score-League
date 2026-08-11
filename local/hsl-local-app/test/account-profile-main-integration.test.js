const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { runAccountMutationWithProfileRefresh } = require("../src/account-profile-orchestration");

const appRoot = path.join(__dirname, "..");

test("main inyecta net.fetch y engancha eventos naturales sin polling", async () => {
  const [main, service, sync] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "src", "account-profile-sync.js"), "utf8"),
  ]);
  assert.match(main, /configureAccountProfileSync\(\{[\s\S]*?fetchImpl: \(url, init\) => net\.fetch\(url, init\)/);
  assert.match(main, /requestAccountProfileSync\([\s\S]*?"startup"[\s\S]*?"connectivity-restored"[\s\S]*?"manual-connectivity"/);
  assert.match(main, /withAccountProfileRefreshAfterMutation\("login"/);
  assert.match(main, /withAccountProfileRefreshAfterMutation\("switch-account"/);
  assert.doesNotMatch(service, /requestAccountProfileSync\("(?:login|switch-account)"/);
  assert.match(main, /cancelAccountProfileSync\("suspend"\)/);
  assert.match(main, /shutdownAccountProfileSync\(\)/);
  assert.doesNotMatch(sync, /setInterval|setTimeout/);
});

test("perfil es enriquecimiento no bloqueante y publica solo una region normal de estado", async () => {
  const [main, service, renderer] = await Promise.all([
    fsp.readFile(path.join(appRoot, "gui", "main.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "launcher-service.js"), "utf8"),
    fsp.readFile(path.join(appRoot, "gui", "renderer", "app.js"), "utf8"),
  ]);
  assert.match(main, /runAccountMutationWithProfileRefresh\([\s\S]*?operation: \(\) => withMembershipContextMutation\(reason, operation\)[\s\S]*?requestProfileSync: service\.requestAccountProfileSync/);
  assert.match(main, /accountProfiles: true,[\s\S]*?publishSnapshot/);
  assert.match(renderer, /"header-account": renderAccountControl\(state\)/);
  assert.match(renderer, /captureRegionInteraction[\s\S]*?restoreRegionInteraction/);
});

test("login y switch solicitan enriquecimiento solo tras éxito y no esperan su descarga", async () => {
  const events = [];
  let finishProfileSync;
  const profileSync = new Promise((resolve) => { finishProfileSync = resolve; });
  const response = await runAccountMutationWithProfileRefresh({
    operation: async () => {
      events.push("cuenta-persistida");
      return { ok: true, state: { usable: true } };
    },
    requestProfileSync: (trigger, options) => {
      events.push(`${trigger}:${options.force}`);
      return profileSync;
    },
    trigger: "login",
  });
  assert.deepEqual(events, ["cuenta-persistida", "login:true"]);
  assert.deepEqual(response, { ok: true, state: { usable: true } });
  finishProfileSync();

  let failedRequests = 0;
  const failed = await runAccountMutationWithProfileRefresh({
    operation: async () => ({ ok: false }),
    requestProfileSync: () => { failedRequests += 1; },
    trigger: "login",
  });
  assert.equal(failed.ok, false);
  assert.equal(failedRequests, 0);
});

test("CSP conserva red deshabilitada e imagenes file locales", async () => {
  const security = await fsp.readFile(path.join(appRoot, "gui", "security-policy.js"), "utf8");
  assert.match(security, /connect-src 'none'/);
  assert.match(security, /img-src 'self' file:/);
  assert.doesNotMatch(security, /img-src[^;]*https:/);
});
