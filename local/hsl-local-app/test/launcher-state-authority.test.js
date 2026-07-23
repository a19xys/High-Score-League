const test = require("node:test");
const assert = require("node:assert/strict");
const { createLauncherStateAuthority } = require("../src/launcher-state-authority");

function state(label) {
  return {
    library: { label },
    selection: { activeInstanceKey: label },
    session: { hasSession: label !== "logout", userId: label },
  };
}

test("main authority reserves request order even when IPC responses finish out of order", async () => {
  const authority = createLauncherStateAuthority();
  const oldIpcRevision = authority.reserveRevision();
  const pushRevision = authority.reserveRevision();
  const pushed = authority.publishSnapshot(state("push"), pushRevision);
  const oldIpc = authority.publishResult({ state: state("old-ipc") }, oldIpcRevision);

  assert.equal(pushed.launcherStateRevision, 2);
  assert.equal(oldIpc.state.launcherStateRevision, 1);
  assert.deepEqual(authority.getDiagnostics(), { currentRevision: 2, publishedSnapshots: 2 });
});

test("renderer gate is the single monotonic rule for full launcher snapshots", async () => {
  const { createLauncherStateGate } = await import("../gui/renderer/launcher-state-gate.js");
  const gate = createLauncherStateGate();
  let applied = null;
  const apply = (snapshot) => {
    const decision = gate.accept(snapshot);
    if (decision.accepted) applied = snapshot;
    return decision;
  };

  apply({ ...state("snapshot-10"), launcherStateRevision: 10 });
  assert.equal(apply({ ...state("snapshot-9"), launcherStateRevision: 9 }).reason, "stale-revision");
  assert.equal(applied.selection.activeInstanceKey, "snapshot-10");

  // The same rule covers old auth, late auto-submit, old-account and old-rescan replies.
  for (const label of ["old-auth", "late-auto-submit", "old-account", "selection-a", "old-rescan"]) {
    assert.equal(apply({ ...state(label), launcherStateRevision: 9 }).accepted, false);
    assert.equal(applied.selection.activeInstanceKey, "snapshot-10");
  }

  assert.equal(apply({ ...state("logout"), launcherStateRevision: 11 }).accepted, true);
  assert.equal(applied.session.hasSession, false);
  assert.equal(apply({ ...state("late-auto-submit"), launcherStateRevision: 10 }).accepted, false);
  assert.equal(applied.session.hasSession, false);

  assert.equal(apply({ ...state("equal-loses"), launcherStateRevision: 11 }).reason, "equal-revision");
  assert.equal(applied.session.hasSession, false);
  assert.equal(apply(state("legacy-loses")).reason, "legacy-after-versioned");
  assert.equal(gate.getDiagnostics().highestRevision, 11);
  assert.equal(gate.getDiagnostics().staleSnapshotsIgnored, 9);
});

test("legacy transition accepts at most one unversioned snapshot and never lets it beat versioned state", async () => {
  const { createLauncherStateGate } = await import("../gui/renderer/launcher-state-gate.js");
  const gate = createLauncherStateGate();
  assert.equal(gate.accept(state("legacy-bootstrap")).accepted, true);
  assert.equal(gate.accept(state("legacy-late")).reason, "duplicate-legacy");
  assert.equal(gate.accept({ ...state("versioned"), launcherStateRevision: 1 }).accepted, true);
  assert.equal(gate.accept(state("legacy-after-versioned")).reason, "legacy-after-versioned");
});

test("authority adds only the revision and does not introduce session secrets or private session paths", () => {
  const authority = createLauncherStateAuthority();
  const published = authority.publishSnapshot(state("safe"));
  const serialized = JSON.stringify(published);
  assert.doesNotMatch(serialized, /access_token|refresh_token|session\.json|canonical-sessions/i);
  assert.equal(published.launcherStateRevision, 1);
});
