const assert = require("node:assert/strict");
const test = require("node:test");
const { createLibrarySnapshotAuthority } = require("../src/library-snapshot-authority");

function library(...instanceKeys) {
  return { packs: instanceKeys.map((instanceKey) => ({ instanceKey })) };
}

test("passive reads reuse one stable local snapshot until an explicit refresh", async () => {
  const scans = [library("a", "b", "c", "d", "e"), library("a", "b", "c", "d")];
  let scanCalls = 0;
  const authority = createLibrarySnapshotAuthority({
    scan: async () => scans[Math.min(scanCalls++, scans.length - 1)],
  });
  const config = { userDataDir: "fixture-a" };

  const initial = await authority.read(config);
  const passiveA = await authority.read(config);
  const passiveB = await authority.read(config);

  assert.equal(scanCalls, 1);
  assert.equal(passiveA, initial);
  assert.equal(passiveB, initial);
  assert.deepEqual(passiveB.packs.map((pack) => pack.instanceKey), ["a", "b", "c", "d", "e"]);

  const refreshed = await authority.read(config, { refresh: true });
  assert.equal(scanCalls, 2);
  assert.deepEqual(refreshed.packs.map((pack) => pack.instanceKey), ["a", "b", "c", "d"]);
  assert.equal(await authority.read(config), refreshed);
});

test("scope changes, invalidation and an authoritative commit cannot leak between libraries", async () => {
  let scanCalls = 0;
  const authority = createLibrarySnapshotAuthority({
    scan: async (config) => library(`${config.userDataDir}-${++scanCalls}`),
  });
  const a = { userDataDir: "a" };
  const b = { userDataDir: "b" };

  const a1 = await authority.read(a);
  const b1 = await authority.read(b);
  assert.notEqual(a1, b1);
  assert.equal(scanCalls, 2);

  const committed = library("a-local-change");
  authority.commit(a, committed);
  assert.equal(await authority.read(a), committed);
  assert.equal(await authority.read(b), b1);

  authority.invalidate(a);
  assert.notEqual(await authority.read(a), committed);
  assert.equal(scanCalls, 3);
});
