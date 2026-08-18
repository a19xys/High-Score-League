const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const rendererRoot = path.join(__dirname, "..", "gui", "renderer");

function createFakeClock(start = 1_000) {
  let now = start;
  let sequence = 0;
  const timers = new Map();

  function setTimeoutFake(callback, delay) {
    const id = ++sequence;
    timers.set(id, { callback, dueAt: now + Math.max(0, delay) });
    return id;
  }

  function tick(duration) {
    const target = now + duration;

    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.dueAt;
      timer.callback();
    }
    now = target;
  }

  return {
    elapse(duration) { now += duration; },
    now: () => now,
    pendingCount: () => timers.size,
    pendingDurations: () => [...timers.values()].map((timer) => timer.dueAt - now).sort((a, b) => a - b),
    tick,
    wait: (duration, { signal } = {}) => new Promise((resolve) => {
      let settled = false;
      let timerId = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timerId !== null) timers.delete(timerId);
        signal?.removeEventListener?.("abort", finish);
        resolve();
      };
      timerId = setTimeoutFake(finish, duration);
      if (signal?.aborted) finish();
      else signal?.addEventListener?.("abort", finish, { once: true });
    }),
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("minimum visible feedback waits only for the remaining duration with a fake clock", async () => {
  const { remainingMinimumVisibleMs, waitForMinimumVisibleDuration } = await import(
    pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href
  );
  const clock = createFakeClock();

  assert.equal(remainingMinimumVisibleMs(1000, 600, 1150), 450);
  assert.equal(remainingMinimumVisibleMs(1000, 600, 1700), 0);

  clock.elapse(150);
  const pending = waitForMinimumVisibleDuration({
    minVisibleMs: 600,
    now: clock.now,
    startedAt: 1000,
    wait: clock.wait,
  });
  await flushMicrotasks();
  assert.deepEqual(clock.pendingDurations(), [450]);
  clock.tick(449);
  assert.equal(clock.pendingCount(), 1);
  clock.tick(1);
  assert.equal(await pending, 450);
  assert.equal(clock.pendingCount(), 0);

  const completedWithoutTimer = await waitForMinimumVisibleDuration({
    minVisibleMs: 600,
    now: () => 1700,
    startedAt: 1000,
    wait: async () => assert.fail("no debe crear un timer si el mínimo ya se cumplió"),
  });
  assert.equal(completedWithoutTimer, 0);
});

test("the common lifecycle covers sync, resolved, success, error, abort and every duration", async () => {
  const {
    DEFAULT_OPERATION_MIN_VISIBLE_MS,
    minimumVisibleMsForScope,
    runWithOperationFeedback,
  } = await import(pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href);
  assert.equal(DEFAULT_OPERATION_MIN_VISIBLE_MS, 600);
  for (const scope of ["transient", "interactive", "external", "background"]) {
    assert.equal(minimumVisibleMsForScope(scope), 600);
  }
  assert.equal(minimumVisibleMsForScope("inline"), 0);

  const inlineClock = createFakeClock();
  let inlineFinished = false;
  const inline = runWithOperationFeedback({
    now: inlineClock.now,
    onFinish: () => { inlineFinished = true; },
    operation: () => "inline",
    scope: "inline",
    wait: inlineClock.wait,
  });
  await flushMicrotasks();
  assert.equal(await inline, "inline");
  assert.equal(inlineFinished, true);
  assert.equal(inlineClock.pendingCount(), 0);

  for (const [label, elapsed, operation] of [
    ["sync", 0, () => "sync"],
    ["already-resolved", 0, () => Promise.resolve("resolved")],
    ["short", 150, (clock) => { clock.elapse(150); return "short"; }],
    ["exact", 600, (clock) => { clock.elapse(600); return "exact"; }],
    ["long", 1_200, (clock) => { clock.elapse(1_200); return "long"; }],
  ]) {
    const clock = createFakeClock();
    let finished = false;
    const pending = runWithOperationFeedback({
      now: clock.now,
      onFinish: () => { finished = true; },
      operation: () => operation(clock),
      scope: label === "already-resolved" ? "external" : "transient",
      wait: clock.wait,
    });
    await flushMicrotasks();
    const remaining = Math.max(0, 600 - elapsed);
    assert.deepEqual(clock.pendingDurations(), remaining ? [remaining] : [], label);
    assert.equal(finished, remaining === 0, label);
    if (remaining) clock.tick(remaining);
    assert.equal(await pending, label === "already-resolved" ? "resolved" : label);
    assert.equal(finished, true, label);
    assert.equal(clock.pendingCount(), 0, label);
  }

  for (const [label, error] of [
    ["error", new Error("failure")],
    ["abort", Object.assign(new Error("cancelled"), { name: "AbortError" })],
  ]) {
    const clock = createFakeClock();
    let finishStatus = null;
    const pending = runWithOperationFeedback({
      now: clock.now,
      onFinish: ({ status }) => { finishStatus = status; },
      operation: () => { throw error; },
      wait: clock.wait,
    });
    await flushMicrotasks();
    assert.deepEqual(clock.pendingDurations(), [600], label);
    clock.tick(600);
    await assert.rejects(pending, error);
    assert.equal(finishStatus, "error", label);
    assert.equal(clock.pendingCount(), 0, label);
  }

  const presentationClock = createFakeClock();
  const presented = runWithOperationFeedback({
    now: presentationClock.now,
    onStart: () => presentationClock.elapse(250),
    operation: () => "presented",
    wait: presentationClock.wait,
  });
  await flushMicrotasks();
  assert.deepEqual(presentationClock.pendingDurations(), [600]);
  presentationClock.tick(600);
  assert.equal(await presented, "presented");
  assert.equal(presentationClock.pendingCount(), 0);
});

test("stale and consecutive runs never close each other or retain timers", async () => {
  const { cancelActiveOperationFeedback, runWithOperationFeedback } = await import(
    pathToFileURL(path.join(rendererRoot, "operation-feedback.js")).href
  );
  const clock = createFakeClock();
  const firstOperation = deferred();
  let currentRunId = null;
  const finishes = [];

  const first = runWithOperationFeedback({
    isCurrent: (runId) => currentRunId === runId,
    now: clock.now,
    onFinish: ({ runId }) => finishes.push(runId),
    onStart: ({ runId }) => { currentRunId = runId; },
    operation: () => firstOperation.promise,
    wait: clock.wait,
  });
  await flushMicrotasks();

  const second = runWithOperationFeedback({
    isCurrent: (runId) => currentRunId === runId,
    now: clock.now,
    onFinish: ({ runId }) => finishes.push(runId),
    onStart: ({ runId }) => { currentRunId = runId; },
    operation: () => "second",
    wait: clock.wait,
  });
  await flushMicrotasks();
  assert.deepEqual(clock.pendingDurations(), [600]);

  firstOperation.resolve("stale");
  await flushMicrotasks();
  assert.equal(await first, "stale");
  assert.deepEqual(clock.pendingDurations(), [600]);
  assert.deepEqual(finishes, []);

  clock.tick(600);
  assert.equal(await second, "second");
  assert.equal(finishes.length, 1);
  assert.equal(clock.pendingCount(), 0);

  let waitingFinished = false;
  const waiting = runWithOperationFeedback({
    now: clock.now,
    onFinish: () => { waitingFinished = true; },
    operation: () => "waiting",
    wait: clock.wait,
  });
  await flushMicrotasks();
  assert.deepEqual(clock.pendingDurations(), [600]);
  cancelActiveOperationFeedback();
  await flushMicrotasks();
  assert.equal(await waiting, "waiting");
  assert.equal(waitingFinished, false);
  assert.equal(clock.pendingCount(), 0);
});

test("every automatic busy overlay entry point uses the common lifecycle", async () => {
  const [app, dialogs] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "app-dialog.js"), "utf8"),
  ]);
  const blocks = [
    ["ranking", "async function openRankingWithOperationFeedback", "function updateSidebarWidth"],
    ["actions", "async function runAction", "async function submitLogin"],
    ["login", "async function submitLogin", "async function switchAccount"],
    ["account switch", "async function switchAccount", "async function activateLibraryPackWithPreload"],
    ["pack activation", "async function activateLibraryPackWithPreload", "function bindActions"],
  ];

  for (const [label, startMarker, endMarker] of blocks) {
    const block = app.slice(app.indexOf(startMarker), app.indexOf(endMarker));
    assert.match(block, /runWithOperationFeedback\(\{/, label);
  }
  assert.equal((app.match(/busy:\s*true/g) || []).length, blocks.length + 1);
  const updaterBlock = app.slice(
    app.indexOf("async function acceptWindowsUpdate"),
    app.indexOf("async function toggleLibraryFavorite"),
  );
  assert.match(updaterBlock, /prepareAndAcceptWindowsUpdate\(\{/);
  assert.match(updaterBlock, /beginBusy: \(\) => store\.setState\(\{ activeDialog: null, busy: true/);
  assert.doesNotMatch(app, /waitForMinimumVisibleDuration|DEFAULT_OPERATION_MIN_VISIBLE_MS|busyStartedAt|activationStartedAt/);
  assert.match(app, /cleanupRendererLifecycle[\s\S]*cancelActiveOperationFeedback\(\)/);

  for (const action of [
    "refresh", "open-pack", "choose-pack-directory", "choose-library-location",
    "detect-library-location", "import-pack-zip", "import-pack-folder",
    "choose-shared-mame-runtime", "open-pack-directory", "open-shared-mame-runtime", "rescan-pack-directory",
    "open-membership-url", "open-manual", "refresh-connectivity", "check-membership", "diagnose", "play",
    "practice", "force-account-sync", "force-ranking-refresh", "restore-failed", "confirm-forget-account",
    "sync-plugin", "logout",
  ]) {
    const start = app.indexOf(`if (action === "${action}")`);
    const next = app.indexOf('\n    if (action === "', start + 1);
    const block = app.slice(start, next < 0 ? app.length : next);
    assert.ok(start >= 0, action);
    assert.match(block, /runAction\(/, action);
  }

  for (const action of ["import-pack", "remove-known-account"]) {
    const start = app.indexOf(`if (action === "${action}")`);
    const next = app.indexOf('\n    if (action === "', start + 1);
    const block = app.slice(start, next);
    assert.match(block, /activeDialog:/, action);
    assert.doesNotMatch(block, /runAction\(/, action);
  }

  const rankingBlock = app.slice(app.indexOf("async function openRankingWithOperationFeedback"), app.indexOf("function updateSidebarWidth"));
  const manualBlock = app.slice(app.indexOf('if (action === "open-manual")'), app.indexOf('if (action === "open-ranking")'));
  const connectionBlock = app.slice(app.indexOf('if (action === "refresh-connectivity")'), app.indexOf('if (action === "check-membership")'));
  const rescanBlock = app.slice(app.indexOf('if (action === "rescan-pack-directory")'), app.indexOf('if (action === "use-library-pack")'));
  assert.match(rankingBlock, /runWithOperationFeedback/);
  assert.match(manualBlock, /runAction/);
  assert.match(connectionBlock, /runAction/);
  assert.match(rescanBlock, /runAction/);
  assert.doesNotMatch(`${rankingBlock}\n${manualBlock}\n${connectionBlock}\n${rescanBlock}`, /setTimeout\([^)]*600|minVisibleMs/);

  assert.match(dialogs, /role="dialog"/);
  assert.doesNotMatch(dialogs, /runWithOperationFeedback|waitForMinimumVisibleDuration|setTimeout/);
  const overlayBlock = app.slice(app.indexOf("function renderOverlay"), app.indexOf("function renderStatusFooter"));
  assert.doesNotMatch(overlayBlock, /runWithOperationFeedback|waitForMinimumVisibleDuration|setTimeout/);
});

test("manual connectivity uses one guarded IPC call and the common overlay lifecycle", async () => {
  const [app, header, overlay] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "header.js"), "utf8"),
    fsp.readFile(path.join(rendererRoot, "components", "busy-overlay.js"), "utf8"),
  ]);
  const manualBlock = app.slice(
    app.indexOf('if (action === "refresh-connectivity")'),
    app.indexOf('if (action === "check-membership")'),
  );

  assert.match(manualBlock, /runAction\(action, "Comprobando conexi\\u00f3n"/);
  assert.equal((manualBlock.match(/requestConnectivityRefresh\("manual"\)/g) || []).length, 1);
  assert.doesNotMatch(manualBlock, /setTimeout|activeOverlay|membership|pack/);
  assert.match(app, /async function runAction[\s\S]*if \(store\.getState\(\)\.busy\) return;[\s\S]*const runId = \+\+busyRunSequence/);
  assert.match(app, /isCurrent: \(\) => runId === busyRunSequence/);
  assert.match(app, /onStart: \(\) => \{[\s\S]*busy: true,[\s\S]*busyLabel/);
  assert.match(app, /runId !== busyRunSequence/);
  assert.match(app, /cleanupRendererLifecycle[\s\S]*busyRunSequence \+= 1;[\s\S]*clearTimeout\(activeBusyPhaseTimer\)/);
  assert.match(manualBlock, /restoreTriggerFocus: true/);
  assert.match(app, /const restoreTriggerFocus = \(\) =>[\s\S]*trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.match(header, /data-action="refresh-connectivity"[\s\S]*aria-label="Comprobar conexión"[\s\S]*aria-busy=/);
  assert.match(header, /disabled aria-disabled=/);
  assert.match(overlay, /title: "Comprobando conexi\\u00f3n\.\.\."/);
  assert.match(overlay, /Verificando la conexión con High Score League\./);
});

test("automatic connectivity signals stay silent and outside operation feedback", async () => {
  const app = await fsp.readFile(path.join(rendererRoot, "app.js"), "utf8");
  for (const [handler, reason] of [
    ["handleRendererOffline", "renderer-offline"],
    ["handleRendererOnline", "renderer-online"],
    ["handleConnectionChange", "connection-change"],
  ]) {
    const start = app.indexOf(`function ${handler}`);
    const block = app.slice(start, app.indexOf("}\n", start) + 2);
    assert.match(block, new RegExp(`requestConnectivityRefresh\\?\\.\\(\"${reason}\"\\)`));
    assert.doesNotMatch(block, /runAction|runWithOperationFeedback|busyLabel|setTimeout/);
  }
});

test("remembered accounts separate known relogin from a valid switch with normal feedback", async () => {
  const [app, overlayModule] = await Promise.all([
    fsp.readFile(path.join(rendererRoot, "app.js"), "utf8"),
    import(pathToFileURL(path.join(rendererRoot, "components", "busy-overlay.js")).href),
  ]);
  const block = app.slice(app.indexOf("async function switchAccount"), app.indexOf("async function activateLibraryPackWithPreload"));

  assert.match(block, /knownAccountForUserId\(currentState, userId\)/);
  assert.match(block, /if \(knownAccount\?\.requiresLogin === true\)[\s\S]*openAccountFormState\(reloginEmail\)[\s\S]*return;/);
  assert.match(block, /runWithOperationFeedback\(\{/);
  assert.match(block, /busy: true[\s\S]*operationFeedbackMode: "overlay"/);
  assert.doesNotMatch(block, /scope: "inline"/);
  assert.match(block, /if \(response\.requiresLogin\)[\s\S]*accountMenuOpen = true[\s\S]*authEmail = response\.email \|\| email[\s\S]*authFormOpen = true/);
  assert.doesNotMatch(block, /setTimeout|minVisibleMs/);
  assert.match(overlayModule.renderBusyOverlay({ busy: true, busyLabel: "Cambiando cuenta", operationFeedbackMode: "overlay" }), /busy-overlay/);
  assert.match(overlayModule.renderBusyOverlay({ busy: true, busyLabel: "Conectando", operationFeedbackMode: "overlay" }), /busy-overlay/);
  assert.match(overlayModule.renderBusyOverlay({ busy: true, operationFeedbackMode: "inline", startup: { visible: true } }), /busy-overlay--startup/);
});
