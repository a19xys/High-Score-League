import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createProfileLiveRefreshLifecycle,
  parsePlayerPlayTimeResponse,
  PROFILE_LIVE_LANE_TIMEOUT_MS,
  PROFILE_LIVE_POLL_INTERVAL_MS,
  type ProfileLiveRefreshEnvironment,
} from "../lib/profile-live-refresh.ts";
import type { PlayerPlayTime, PlayerPlayTimeDto } from "../lib/playtime.ts";
import type { PlayerPresence } from "../lib/player-presence.ts";

const offline: PlayerPresence = { visibility: "visible", status: "offline" };
const connected: PlayerPresence = {
  visibility: "visible",
  status: "connected",
  sources: ["web"],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeEnvironment(initialVisibility: "visible" | "hidden" = "visible") {
  let visibility = initialVisibility;
  let nextTimer = 1;
  const timers = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  const delays: number[] = [];
  const focusListeners = new Set<() => void>();
  const visibilityListeners = new Set<() => void>();
  const environment: ProfileLiveRefreshEnvironment = {
    getVisibilityState: () => visibility,
    setInterval: (listener, delay) => {
      const timer = nextTimer++;
      timers.set(timer, listener);
      delays.push(delay);
      return timer;
    },
    clearInterval: (timer) => timers.delete(timer as number),
    setTimeout: (listener) => {
      const timer = nextTimer++;
      timeouts.set(timer, listener);
      return timer;
    },
    clearTimeout: (timer) => timeouts.delete(timer as number),
    addFocusListener: (listener) => focusListeners.add(listener),
    removeFocusListener: (listener) => focusListeners.delete(listener),
    addVisibilityListener: (listener) => visibilityListeners.add(listener),
    removeVisibilityListener: (listener) => visibilityListeners.delete(listener),
  };
  return {
    environment,
    timers,
    timeouts,
    delays,
    setVisibility(value: "visible" | "hidden") { visibility = value; },
    focus() { focusListeners.forEach((listener) => listener()); },
    visibilityChange() { visibilityListeners.forEach((listener) => listener()); },
    fireNextTimeout() {
      const entry = timeouts.entries().next().value as [number, () => void] | undefined;
      if (!entry) return false;
      timeouts.delete(entry[0]);
      entry[1]();
      return true;
    },
    get listenerCount() { return focusListeners.size + visibilityListeners.size; },
  };
}

function harness({
  initialPlayTime = { visibility: "visible", totalSeconds: 12240 },
  initialPresence = offline,
  visibility = "visible",
  readPlayTime = async () => ({ visibility: "visible", totalSeconds: 12600 } as const),
  readPresence = async () => connected,
  laneTimeoutMs = PROFILE_LIVE_LANE_TIMEOUT_MS,
}: {
  initialPlayTime?: PlayerPlayTime;
  initialPresence?: PlayerPresence;
  visibility?: "visible" | "hidden";
  readPlayTime?: (signal: AbortSignal) => Promise<PlayerPlayTimeDto | null>;
  readPresence?: (signal: AbortSignal) => Promise<PlayerPresence | null>;
  laneTimeoutMs?: number;
} = {}) {
  const clock = fakeEnvironment(visibility);
  let playTime = initialPlayTime;
  let presence = initialPresence;
  let playTimeReads = 0;
  let presenceReads = 0;
  let playTimeUpdates = 0;
  let presenceUpdates = 0;
  const lifecycle = createProfileLiveRefreshLifecycle({
    environment: clock.environment,
    readPlayTime: (signal) => {
      playTimeReads += 1;
      return readPlayTime(signal);
    },
    readPresence: (signal) => {
      presenceReads += 1;
      return readPresence(signal);
    },
    applyPlayTime: (value) => {
      playTime = value;
      playTimeUpdates += 1;
    },
    applyPresence: (value) => {
      presence = value;
      presenceUpdates += 1;
    },
    laneTimeoutMs,
  });
  return {
    clock,
    lifecycle,
    get playTime() { return playTime; },
    get presence() { return presence; },
    get playTimeReads() { return playTimeReads; },
    get presenceReads() { return presenceReads; },
    get playTimeUpdates() { return playTimeUpdates; },
    get presenceUpdates() { return presenceUpdates; },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("SSR snapshots remain the first render and one 15 s cadence owns both reads", async () => {
  const live = harness();
  assert.equal(PROFILE_LIVE_LANE_TIMEOUT_MS < PROFILE_LIVE_POLL_INTERVAL_MS, true);
  assert.deepEqual(live.playTime, { visibility: "visible", totalSeconds: 12240 });
  assert.deepEqual(live.presence, offline);
  assert.equal(live.playTimeReads, 0);
  assert.equal(live.presenceReads, 0);
  assert.equal(live.clock.timers.size, 1);
  assert.deepEqual(live.clock.delays, [PROFILE_LIVE_POLL_INTERVAL_MS]);

  const component = await readFile(
    join(process.cwd(), "components/profile/profile-live-stats.tsx"),
    "utf8",
  );
  assert.match(component, /useState\(initialPlayTime\)/);
  assert.match(component, /useState\(initialPresence\)/);
  assert.doesNotMatch(component, /loading|router\.refresh|WebSocket|EventSource/i);
  await assert.rejects(
    readFile(join(process.cwd(), "components/profile/profile-presence-stat.tsx"), "utf8"),
  );
  live.lifecycle.dispose();
});

test("a valid shared refresh updates both values and accepts a canonical decrease", async () => {
  const live = harness({
    readPlayTime: async () => ({ visibility: "visible", totalSeconds: 11000 }),
  });
  await live.lifecycle.refresh();
  assert.deepEqual(live.playTime, { visibility: "visible", totalSeconds: 11000 });
  assert.deepEqual(live.presence, connected);
  assert.equal(live.playTimeReads, 1);
  assert.equal(live.presenceReads, 1);
  live.lifecycle.dispose();
});

test("one failed read retains its last value without blocking the other result", async () => {
  const presenceFails = harness({
    readPresence: async () => { throw new Error("503"); },
  });
  await presenceFails.lifecycle.refresh();
  assert.deepEqual(presenceFails.presence, offline);
  assert.deepEqual(presenceFails.playTime, {
    visibility: "visible",
    totalSeconds: 12600,
  });
  presenceFails.lifecycle.dispose();

  const playTimeFails = harness({
    readPlayTime: async () => { throw new Error("503"); },
  });
  await playTimeFails.lifecycle.refresh();
  assert.deepEqual(playTimeFails.playTime, {
    visibility: "visible",
    totalSeconds: 12240,
  });
  assert.deepEqual(playTimeFails.presence, connected);
  playTimeFails.lifecycle.dispose();
});

test("malformed Playtime is ignored while valid privacy transitions replace old state", async () => {
  assert.equal(parsePlayerPlayTimeResponse({
    ok: true,
    playTime: { visibility: "visible", totalSeconds: "uwu" },
  }), null);
  assert.equal(parsePlayerPlayTimeResponse({
    ok: true,
    playTime: { visibility: "visible", totalSeconds: -1 },
  }), null);
  assert.deepEqual(parsePlayerPlayTimeResponse({
    ok: true,
    playTime: { visibility: "visible", totalSeconds: 12240.9 },
  }), { visibility: "visible", totalSeconds: 12240 });

  const malformed = harness({ readPlayTime: async () => null });
  await malformed.lifecycle.refresh();
  assert.deepEqual(malformed.playTime, {
    visibility: "visible",
    totalSeconds: 12240,
  });
  malformed.lifecycle.dispose();

  const becomesPrivate = harness({
    readPlayTime: async () => ({ visibility: "private" }),
  });
  await becomesPrivate.lifecycle.refresh();
  assert.deepEqual(becomesPrivate.playTime, { visibility: "private" });
  becomesPrivate.lifecycle.dispose();

  const becomesPublic = harness({
    initialPlayTime: { visibility: "private" },
    readPlayTime: async () => ({ visibility: "visible", totalSeconds: 12240 }),
  });
  await becomesPublic.lifecycle.refresh();
  assert.deepEqual(becomesPublic.playTime, {
    visibility: "visible",
    totalSeconds: 12240,
  });
  becomesPublic.lifecycle.dispose();
});

test("hidden pages do not poll and becoming visible refreshes immediately", async () => {
  const live = harness({ visibility: "hidden" });
  assert.equal(live.clock.timers.size, 0);
  await live.lifecycle.refresh();
  assert.equal(live.playTimeReads, 0);
  assert.equal(live.presenceReads, 0);

  live.clock.setVisibility("visible");
  live.clock.visibilityChange();
  await flush();
  assert.equal(live.clock.timers.size, 1);
  assert.equal(live.playTimeReads, 1);
  assert.equal(live.presenceReads, 1);
  live.lifecycle.dispose();
});

test("focus refreshes immediately and keeps a single interval", async () => {
  const live = harness();
  live.clock.focus();
  await flush();
  assert.equal(live.playTimeReads, 1);
  assert.equal(live.presenceReads, 1);
  assert.equal(live.clock.timers.size, 1);
  assert.deepEqual(live.clock.delays, [15_000, 15_000]);
  live.lifecycle.dispose();
});

test("a hung Presence lane does not block Playtime or duplicate Presence on the next tick", async () => {
  const presenceRequest = deferred<PlayerPresence | null>();
  let playTimeTotal = 12_600;
  const live = harness({
    readPresence: () => presenceRequest.promise,
    readPlayTime: async () => ({
      visibility: "visible",
      totalSeconds: playTimeTotal,
    }),
  });
  const first = live.lifecycle.refresh();
  await flush();
  assert.deepEqual(live.playTime, { visibility: "visible", totalSeconds: 12_600 });
  assert.equal(live.presenceReads, 1);
  playTimeTotal = 13_000;
  [...live.clock.timers.values()][0]?.();
  await flush();
  assert.equal(live.presenceReads, 1);
  assert.equal(live.playTimeReads, 2);
  assert.deepEqual(live.playTime, { visibility: "visible", totalSeconds: 13_000 });
  presenceRequest.resolve(connected);
  await first;
  live.lifecycle.dispose();
});

test("a hung Playtime lane does not block Presence or duplicate Playtime on the next tick", async () => {
  const playTimeRequest = deferred<PlayerPlayTimeDto | null>();
  let nextPresence: PlayerPresence = connected;
  const live = harness({
    readPlayTime: () => playTimeRequest.promise,
    readPresence: async () => nextPresence,
  });
  const first = live.lifecycle.refresh();
  await flush();
  assert.deepEqual(live.presence, connected);
  nextPresence = { visibility: "private" };
  [...live.clock.timers.values()][0]?.();
  await flush();
  assert.equal(live.playTimeReads, 1);
  assert.equal(live.presenceReads, 2);
  assert.deepEqual(live.presence, { visibility: "private" });
  playTimeRequest.resolve({ visibility: "visible", totalSeconds: 12_600 });
  await first;
  live.lifecycle.dispose();
});

test("a lane timeout aborts its generation, retains state and permits a clean retry", async () => {
  const stalePresence = deferred<PlayerPresence | null>();
  let capturedSignal: AbortSignal | null = null;
  let reads = 0;
  const live = harness({
    laneTimeoutMs: 9_000,
    readPresence: (signal) => {
      capturedSignal = signal;
      reads += 1;
      return reads === 1 ? stalePresence.promise : Promise.resolve(connected);
    },
  });
  const first = live.lifecycle.refresh();
  await flush();
  assert.equal(live.clock.fireNextTimeout(), true);
  await first;
  assert.equal(capturedSignal?.aborted, true);
  assert.deepEqual(live.presence, offline);

  await live.lifecycle.refresh();
  assert.equal(live.presenceReads, 2);
  assert.deepEqual(live.presence, connected);
  stalePresence.resolve({ visibility: "private" });
  await flush();
  assert.deepEqual(live.presence, connected);
  live.lifecycle.dispose();
});

test("dispose aborts both lanes, removes cadence/timeouts/listeners and blocks late updates", async () => {
  const playTimeRequest = deferred<PlayerPlayTimeDto | null>();
  const presenceRequest = deferred<PlayerPresence | null>();
  const signals: AbortSignal[] = [];
  const live = harness({
    readPlayTime: (signal) => {
      signals.push(signal);
      return playTimeRequest.promise;
    },
    readPresence: (signal) => {
      signals.push(signal);
      return presenceRequest.promise;
    },
  });
  const refresh = live.lifecycle.refresh();
  await flush();
  live.lifecycle.dispose();
  await refresh;
  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal.aborted), true);
  assert.equal(live.clock.timers.size, 0);
  assert.equal(live.clock.timeouts.size, 0);
  assert.equal(live.clock.listenerCount, 0);
  playTimeRequest.resolve({ visibility: "visible", totalSeconds: 99999 });
  presenceRequest.resolve(connected);
  await flush();
  assert.equal(live.playTimeUpdates, 0);
  assert.equal(live.presenceUpdates, 0);
  assert.deepEqual(live.playTime, {
    visibility: "visible",
    totalSeconds: 12240,
  });
});
