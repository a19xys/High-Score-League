const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = (relative) => fsp.readFile(path.join(root, relative), "utf8");

test("product flows resolve canonical sessions and never refresh or persist legacy copies", async () => {
  const [membership, submission, launcher, auth] = await Promise.all([
    source("src/season-membership.js"),
    source("src/submission-service.js"),
    source("gui/launcher-service.js"),
    source("src/auth.js"),
  ]);
  assert.match(membership, /resolveCanonicalSession/);
  assert.match(submission, /resolveCanonicalSession/);
  assert.doesNotMatch(membership, /require\("\.\/auth"\)[^\n]*getValidStoredSession/);
  assert.doesNotMatch(submission, /require\("\.\/auth"\)[^\n]*getValidStoredSession/);
  assert.doesNotMatch(launcher, /refreshStoredSession|saveRememberedSession|saveSession\(config/);
  assert.match(launcher, /sessionRepository\(config\)\.setActive/);
  assert.doesNotMatch(auth, /writeStoredSession\(config\.sessionFileAbs|readStoredSession\(config\.sessionFileAbs/);
});

test("legacy session path is confined to configuration, migration, compatibility tests and diagnostics", async () => {
  const [repository, auth, main, coordinator] = await Promise.all([
    source("src/account-session-repository.js"),
    source("src/auth.js"),
    source("gui/main.js"),
    source("src/pending-auto-submit-coordinator.js"),
  ]);
  assert.match(repository, /config\.sessionFileAbs/);
  assert.doesNotMatch(auth, /sessionFileAbs[^\n]*(read|write|unlink)/);
  assert.doesNotMatch(main, /session\.json|sessionFileAbs/);
  assert.match(coordinator, /context\.userId, context\.index\?\.revision, context\.sessionRevision/);
  assert.match(coordinator, /reachabilityGeneration/);
  assert.doesNotMatch(coordinator.slice(coordinator.indexOf("pendingAutoSubmitGuardKey"), coordinator.indexOf("pendingAutoSubmitExecutionKey")), /reachabilityGeneration/);
});

test("normal auth never resets auto-submit guards and connectivity authority remains closed", async () => {
  const [main, auth, connectivity] = await Promise.all([
    source("gui/main.js"),
    source("src/auth.js"),
    source("src/connectivity-service.js"),
  ]);
  assert.doesNotMatch(auth, /resetGuards|cancelCurrentRun/);
  assert.equal((main.match(/\.resetGuards\(/g) || []).length, 1);
  assert.match(main, /resetGuards\("development-force"\)/);
  assert.doesNotMatch(main, /markReachable/);
  assert.doesNotMatch(connectivity, /markReachable/);
});

test("renderer and diagnostics surfaces contain no session tokens or physical session path", async () => {
  const [preload, renderer, diagnostic] = await Promise.all([
    source("gui/preload.js"),
    source("gui/renderer/components/dev-tools.js"),
    source("src/diagnostic-logs.js"),
  ]);
  assert.doesNotMatch(preload + renderer, /access_token|refresh_token|provider_token|sessionFile/);
  assert.match(diagnostic, /access_token|refresh_token/);
  assert.match(diagnostic, /SENSITIVE_KEY/);
});
