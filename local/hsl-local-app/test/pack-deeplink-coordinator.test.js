const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_PENDING_PACK_IMPORTS,
  createPackDeepLinkCoordinator,
} = require("../src/pack-deeplink-coordinator");

test("coordinator conserva FIFO, peek no consume y cancel/success sí consumen", () => {
  let sequence = 0;
  const coordinator = createPackDeepLinkCoordinator({
    createId: () => `intent-${++sequence}`,
    now: () => "2026-08-20T00:00:00.000Z",
  });
  coordinator.enqueue("alpha");
  coordinator.enqueue("beta");
  assert.equal(coordinator.peek().packId, "alpha");
  assert.equal(coordinator.peek().packId, "alpha");
  assert.equal(coordinator.cancel("intent-2"), false);
  assert.equal(coordinator.cancel("intent-1"), true);
  assert.equal(coordinator.peek().packId, "beta");
  assert.equal(coordinator.complete("intent-2"), true);
  assert.equal(coordinator.peek(), null);
});

test("coordinator deduplica pendientes y limita ocho identidades distintas", () => {
  let sequence = 0;
  const coordinator = createPackDeepLinkCoordinator({ createId: () => `id-${++sequence}` });
  assert.equal(coordinator.enqueue("same-pack").accepted, true);
  assert.equal(coordinator.enqueue("same-pack").reason, "duplicate");
  for (let index = 1; index < MAX_PENDING_PACK_IMPORTS; index += 1) {
    assert.equal(coordinator.enqueue(`pack-${index}`).accepted, true);
  }
  assert.equal(coordinator.inspect().count, MAX_PENDING_PACK_IMPORTS);
  assert.equal(coordinator.enqueue("overflow").reason, "capacity");
});

test("intent sobrevive hasta interactive y sólo entonces se anuncia", () => {
  let announcements = 0;
  const coordinator = createPackDeepLinkCoordinator({
    createId: () => "intent-1",
    onAvailable: () => { announcements += 1; },
  });
  coordinator.enqueue("alpha");
  assert.equal(announcements, 0);
  assert.equal(coordinator.peek().packId, "alpha");
  coordinator.markRendererReady();
  assert.equal(announcements, 1);
  coordinator.markRendererUnavailable();
  coordinator.markRendererReady();
  assert.equal(announcements, 2);
});
