const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

async function rendererSource(file) {
  return fsp.readFile(path.join(rendererRoot, file), "utf8");
}

test("explicit Ranking uses common operation feedback with one guarded IPC call", async () => {
  const app = await rendererSource("app.js");
  const start = app.indexOf("async function openRankingWithOperationFeedback");
  const end = app.indexOf("function updateSidebarWidth", start);
  const block = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(block, /if \(activeRankingFeedback \|\| store\.getState\(\)\.busy\) return/);
  assert.match(block, /runWithOperationFeedback\(\{/);
  assert.match(block, /scope: "external"/);
  assert.match(block, /onStart: \(\{ runId \}\)/);
  assert.match(block, /busy: true, busyLabel: "Abriendo ranking", rankingOpening: true/);
  assert.match(block, /isCurrent: \(runId\) => activeRankingFeedback\?\.runId === runId/);
  assert.match(block, /activeRun\.contextKey === responseContextKey/);
  assert.match(block, /No se pudo abrir el ranking/);
  assert.equal((block.match(/window\.hslLauncher\.openRanking\(\)/g) || []).length, 1);
});

test("automatic Ranking capability updates remain silent and context changes invalidate feedback", async () => {
  const app = await rendererSource("app.js");
  const start = app.indexOf("function applyRankingCapabilitiesState");
  const end = app.indexOf("function applyBackgroundLauncherState", start);
  const automaticBlock = app.slice(start, end);

  assert.doesNotMatch(automaticBlock, /runWithOperationFeedback|busyLabel|renderBusyOverlay/);
  assert.match(app, /invalidateStaleRankingFeedback\(nextData\)/);
  assert.match(app, /activeRankingFeedback = null;[\s\S]*rankingOpening: false/);
  assert.match(app, /function cleanupRendererLifecycle\(\) \{[\s\S]*activeRankingFeedback = null/);
});

test("Ranking overlay is accessible and uses the existing opening copy", async () => {
  const overlay = await import(pathToFileURL(path.join(rendererRoot, "components", "busy-overlay.js")).href);
  const html = overlay.renderBusyOverlay({ busy: true, busyLabel: "Abriendo ranking" });

  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Abriendo ranking\.\.\./);
  assert.match(html, /clasificaci[oó]n del juego/i);
});

test("normal account success skips its log while login and failures keep their paths", async () => {
  const app = await rendererSource("app.js");
  const start = app.indexOf("async function switchAccount");
  const end = app.indexOf("async function activateLibraryPackWithPreload", start);
  const block = app.slice(start, end);

  assert.match(block, /if \(shouldSurfaceAccountSwitchResult\(response\)\)/);
  assert.match(block, /nextState\.logs = appendLog/);
  assert.match(block, /if \(response\.requiresLogin\)/);
  assert.match(block, /authError: "No se pudo cambiar de cuenta/);
  assert.match(block, /ok: false/);
});
