const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { launchMame } = require("../src/mame-launcher");
const { createPlayTimeRecorder } = require("../src/playtime-recorder");

function fakeStore(events) {
  return {
    clearActive: async () => {},
    recordEvent: async (event) => events.push(event),
    writeActive: async () => {},
  };
}

function input(store, overrides = {}) {
  return {
    clientVersion: "test",
    gameKey: "space-invaders",
    mode: "practice",
    playerKey: "user-a",
    rom: "invaders",
    store,
    userId: "a",
    weekId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

test("recorder starts at spawn, freezes context and finalizes exactly once", async () => {
  let monotonic = 0n;
  let wall = new Date("2026-08-11T10:00:00.000Z");
  const events = [];
  const recorder = createPlayTimeRecorder({
    dateNow: () => wall,
    monotonicNow: () => monotonic,
    randomUUID: () => "11111111-1111-4111-8111-111111111111",
  });
  const context = input(fakeStore(events));
  const session = recorder.prepare(context);
  assert.equal(events.length, 0);
  await session.onSpawn();
  context.gameKey = "pac-man";
  context.userId = "b";
  monotonic = 65_000_000_000n;
  wall = new Date("2025-01-01T00:00:00.000Z");
  const [first, second] = await Promise.all([session.onClose(1), session.finalize()]);
  assert.equal(first, second);
  assert.equal(events.length, 1);
  assert.equal(events[0].durationSeconds, 65);
  assert.equal(events[0].gameKey, "space-invaders");
  assert.equal(events[0].endedAt, events[0].startedAt);
  assert.equal(session.context.userId, "a");
});

test("suspend time is excluded and resume continues monotonic accumulation", async () => {
  let monotonic = 0n;
  const events = [];
  const recorder = createPlayTimeRecorder({
    dateNow: () => new Date("2026-08-11T10:00:00.000Z"),
    monotonicNow: () => monotonic,
    randomUUID: () => "22222222-2222-4222-8222-222222222222",
  });
  const session = recorder.prepare(input(fakeStore(events), { mode: "competition" }));
  await session.onSpawn();
  monotonic = 5_000_000_000n;
  recorder.pauseAll();
  monotonic = 100_000_000_000n;
  recorder.resumeAll();
  monotonic = 103_000_000_000n;
  await recorder.finalizeAll();
  await session.onClose();
  assert.equal(events.length, 1);
  assert.equal(events[0].durationSeconds, 8);
  assert.equal(events[0].mode, "competition");
});

test("anonymous preparation and child error before spawn produce no event", async () => {
  const events = [];
  const recorder = createPlayTimeRecorder();
  assert.equal(recorder.prepare(input(fakeStore(events), { userId: null })), null);
  const lifecycle = recorder.prepare(input(fakeStore(events)));
  const config = { mame: { executablePath: "C:/MAME/mame.exe", workingDir: "C:/MAME" } };
  const originalLog = console.log;
  console.log = () => {};
  try {
    await assert.rejects(launchMame(config, "invaders", "practice", () => {
      const child = new EventEmitter();
      process.nextTick(() => child.emit("error", new Error("spawn failed")));
      return child;
    }, lifecycle), /spawn failed/);
  } finally {
    console.log = originalLog;
  }
  assert.equal(events.length, 0);
});

test("MAME lifecycle records practice after spawn even with nonzero exit", async () => {
  let monotonic = 0n;
  const events = [];
  const recorder = createPlayTimeRecorder({
    monotonicNow: () => monotonic,
    randomUUID: () => "33333333-3333-4333-8333-333333333333",
  });
  const lifecycle = recorder.prepare(input(fakeStore(events)));
  const config = { mame: { executablePath: "C:/MAME/mame.exe", workingDir: "C:/MAME" } };
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.equal(await launchMame(config, "invaders", "practice", () => {
      const child = new EventEmitter();
      process.nextTick(() => {
        child.emit("spawn");
        monotonic = 9_000_000_000n;
        child.emit("close", 7);
      });
      return child;
    }, lifecycle), 7);
  } finally {
    console.log = originalLog;
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].durationSeconds, 9);
});
