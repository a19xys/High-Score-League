const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { atomicWriteJson } = require("../src/secure-session-storage");
const { createPlayTimeStore } = require("../src/playtime-store");

function event(id, gameKey = "space-invaders", seconds = 60) {
  return {
    clientVersion: "test",
    durationSeconds: seconds,
    endedAt: "2026-08-11T10:01:00.000Z",
    eventId: id,
    gameKey,
    mode: "practice",
    rom: "invaders",
    startedAt: "2026-08-11T10:00:00.000Z",
    weekId: "11111111-1111-4111-8111-111111111111",
  };
}

test("store accumulates games, isolates players and never double-applies pending", async (t) => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-playtime-store-"));
  t.after(() => fsp.rm(userDataDir, { recursive: true, force: true }));
  const a = createPlayTimeStore({ userDataDir }, "user-a");
  const b = createPlayTimeStore({ userDataDir }, "user-b");
  const first = event("11111111-1111-4111-8111-111111111111", "space-invaders", 60);
  await a.recordEvent(first);
  await a.recordEvent(first);
  await a.recordEvent(event("22222222-2222-4222-8222-222222222222", "pac-man", 120));
  await b.recordEvent(event("33333333-3333-4333-8333-333333333333", "space-invaders", 30));
  const summaryA = await a.readSummary();
  assert.match(summaryA.updatedAt, /^\d{4}-/);
  assert.deepEqual({ ...summaryA, updatedAt: null }, {
    games: { "pac-man": { totalSeconds: 120 }, "space-invaders": { totalSeconds: 60 } },
    pendingApplied: {
      "11111111-1111-4111-8111-111111111111": { durationSeconds: 60, gameKey: "space-invaders" },
      "22222222-2222-4222-8222-222222222222": { durationSeconds: 120, gameKey: "pac-man" },
    },
    schemaVersion: 1,
    totalSeconds: 180,
    updatedAt: null,
  });
  assert.equal((await b.readSummary()).totalSeconds, 30);
});

test("pending-first recovery, ACK and orphan cleanup preserve accumulated totals", async (t) => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-playtime-recovery-"));
  t.after(() => fsp.rm(userDataDir, { recursive: true, force: true }));
  let failSummaryOnce = true;
  const crashing = createPlayTimeStore({ userDataDir }, "user-a", {
    atomicWriteImpl: async (filePath, value) => {
      if (filePath.endsWith("summary.json") && failSummaryOnce) {
        failSummaryOnce = false;
        throw new Error("simulated-crash");
      }
      return atomicWriteJson(filePath, value);
    },
  });
  const pendingEvent = event("44444444-4444-4444-8444-444444444444", "space-invaders", 75);
  await assert.rejects(crashing.recordEvent(pendingEvent), /simulated-crash/);
  const recovered = createPlayTimeStore({ userDataDir }, "user-a");
  assert.equal((await recovered.readSummary()).totalSeconds, 75);
  assert.equal((await recovered.readSummary()).totalSeconds, 75);
  assert.equal((await recovered.listPending()).length, 1);
  await recovered.acknowledge(pendingEvent.eventId);
  const summary = await recovered.readSummary();
  assert.equal(summary.totalSeconds, 75);
  assert.deepEqual(summary.pendingApplied, {});
  assert.equal((await recovered.listPending()).length, 0);
});

test("corrupt summary is quarantined and rebuilt from pending without silent duplication", async (t) => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-playtime-corrupt-"));
  t.after(() => fsp.rm(userDataDir, { recursive: true, force: true }));
  const store = createPlayTimeStore({ userDataDir }, "user-a");
  await store.recordEvent(event("55555555-5555-4555-8555-555555555555", "space-invaders", 90));
  await fsp.writeFile(store.paths.summary, "{broken", "utf8");
  assert.equal((await store.readSummary()).totalSeconds, 90);
  assert.equal((await store.readSummary()).totalSeconds, 90);
  assert.ok((await fsp.readdir(store.paths.root)).some((name) => name.startsWith("summary.json.corrupt-")));
});
