const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const moduleUrl = pathToFileURL(path.join(__dirname, "..", "gui", "renderer", "asset-preloader.js"));

function harness() {
  let now = 0;
  let timerId = 0;
  const images = [];
  const timers = new Map();
  const createImage = () => {
    const image = { onerror: null, onload: null, src: "" };
    images.push(image);
    return image;
  };
  return {
    createImage,
    images,
    now: () => now,
    setNow: (value) => { now = value; },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fireTimers() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); } },
    timerCount: () => timers.size,
  };
}

test("hero and logo loads settle independently", async () => {
  const { createAssetPreloader } = await import(moduleUrl);
  const fake = harness();
  const preloader = createAssetPreloader({ clearTimeoutImpl: fake.clearTimeout, createImage: fake.createImage, now: fake.now, setTimeoutImpl: fake.setTimeout });
  const hero = preloader.preload("hero.png");
  const logo = preloader.preload("logo.png");
  fake.images[0].onerror();
  fake.images[1].onload();
  assert.equal((await hero).status, "error");
  assert.equal((await logo).status, "loaded");
});

test("timeout detaches handlers so a late success cannot be applied", async () => {
  const { createAssetPreloader } = await import(moduleUrl);
  const fake = harness();
  const preloader = createAssetPreloader({ clearTimeoutImpl: fake.clearTimeout, createImage: fake.createImage, now: fake.now, setTimeoutImpl: fake.setTimeout, timeoutMs: 10 });
  const pending = preloader.preload("slow.png");
  const lateHandler = fake.images[0].onload;
  fake.fireTimers();
  assert.equal((await pending).status, "timeout");
  assert.equal(fake.images[0].onload, null);
  assert.equal(fake.images[0].onerror, null);
  lateHandler();
  assert.equal(preloader.getDiagnostics().activeLoads, 0);
});

test("failures expire for retry and the cache is bounded", async () => {
  const { createAssetPreloader } = await import(moduleUrl);
  const fake = harness();
  const preloader = createAssetPreloader({ clearTimeoutImpl: fake.clearTimeout, createImage: fake.createImage, failureTtlMs: 5, maxEntries: 2, now: fake.now, setTimeoutImpl: fake.setTimeout });
  const first = preloader.preload("broken.png");
  fake.images[0].onerror();
  await first;
  assert.equal((await preloader.preload("broken.png")).status, "error");
  assert.equal(fake.images.length, 1);
  fake.setNow(6);
  const retry = preloader.preload("broken.png");
  assert.equal(fake.images.length, 2);
  fake.images[1].onload();
  await retry;
  for (const url of ["a.png", "b.png"]) {
    const promise = preloader.preload(url);
    fake.images.at(-1).onload();
    await promise;
  }
  assert.ok(preloader.getDiagnostics().cacheEntries <= 2);
});

test("asset identity requires selection, URL, kind and generation", async () => {
  const { assetIdentityMatches } = await import(moduleUrl);
  const element = { dataset: { assetGeneration: "3", assetKind: "hero", assetSelection: "A", assetUrl: "a.png" } };
  assert.equal(assetIdentityMatches(element, { generation: 3, kind: "hero", selection: "A", url: "a.png" }), true);
  for (const current of [
    { generation: 2, kind: "hero", selection: "A", url: "a.png" },
    { generation: 3, kind: "logo", selection: "A", url: "a.png" },
    { generation: 3, kind: "hero", selection: "B", url: "a.png" },
    { generation: 3, kind: "hero", selection: "A", url: "b.png" },
  ]) assert.equal(assetIdentityMatches(element, current), false);
});

test("dispose cancels every active image and clears timers and cache", async () => {
  const { createAssetPreloader } = await import(moduleUrl);
  const fake = harness();
  const preloader = createAssetPreloader({ clearTimeoutImpl: fake.clearTimeout, createImage: fake.createImage, now: fake.now, setTimeoutImpl: fake.setTimeout });
  const pending = preloader.preload("active.png");
  preloader.dispose();
  assert.equal((await pending).status, "cancelled");
  assert.deepEqual(preloader.getDiagnostics(), { activeLoads: 0, cacheEntries: 0, disposed: true });
  assert.equal(fake.timerCount(), 0);
});
