const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

test("Electron quit and suspend use bounded session drains without a quit loop", async () => {
  const main = await fsp.readFile(path.join(__dirname, "..", "gui", "main.js"), "utf8");
  const service = await fsp.readFile(path.join(__dirname, "..", "gui", "launcher-service.js"), "utf8");
  const coordinator = await fsp.readFile(path.join(__dirname, "..", "src", "exit-coordinator.js"), "utf8");
  assert.match(main, /createExitCoordinator\(\{/);
  assert.match(main, /app\.on\("before-quit", \(event\) => \{[\s\S]*exitCoordinator\.handleBeforeQuit\(event\)/);
  assert.match(coordinator, /event\?\.preventDefault\?\.\(\)/);
  assert.match(coordinator, /if \(phase === "armed"\) return false/);
  assert.match(coordinator, /if \(drainPromise\) return drainPromise/);
  assert.match(main, /shutdownAccountSessions\(\{ reason: "shutdown", timeoutMs: 3000 \}\)/);
  assert.match(main, /drainAccountSessionOperations\?\.\(\{[\s\S]*reason: "suspend"[\s\S]*timeoutMs: 2000/);
  assert.match(service, /async function drainAccountSessionOperations/);
  assert.match(service, /\.drain\(options\)/);
  assert.match(service, /async function shutdownAccountSessions/);
  assert.match(service, /\.shutdown\(options\)/);
  assert.match(main, /coordinateMembershipResult\([\s\S]*`auto-submit:\$\{context\?\.trigger \|\| "result"\}`,[\s\S]*\{ scheduleAutoSubmit: false \}/);
});

test("CLI installs signal cleanup and awaits the final bounded repository drain", async () => {
  const appEntry = await fsp.readFile(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(appEntry, /process\.once\("SIGINT"/);
  assert.match(appEntry, /process\.once\("SIGTERM"/);
  assert.match(appEntry, /shutdownAccountSessionRepositories\(\{ reason: "cli-complete", timeoutMs: 2000 \}\)/);
  assert.doesNotMatch(appEntry, /process\.exit\(/);
});
