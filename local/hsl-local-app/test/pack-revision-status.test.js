const test = require("node:test");
const assert = require("node:assert/strict");
const {
  derivePackRevisionStatus,
  isRevisionManagedPack,
} = require("../src/pack-revision-status");

const managedPack = {
  packId: "space-invaders-s1-w1-r1",
  packVersion: 2,
  contract: { mame: { profiles: { competition: { integrity: { version: 1 } } } } },
};

test("solo el contrato protegido v2 entra en gestión de revisiones", () => {
  assert.equal(isRevisionManagedPack(managedPack), true);
  assert.equal(isRevisionManagedPack({ packVersion: 1 }), false);
  assert.equal(derivePackRevisionStatus({ pack: { packVersion: 1 } }).status, "current");
});

test("estado local distingue current, outdated, current-unverified y unknown sin parsear sufijos", () => {
  const current = derivePackRevisionStatus({
    authorityConfirmed: true,
    capability: { publishedPackId: "space-invaders-s1-w1-r1" },
    pack: managedPack,
    provenanceMode: "remote_verified",
  });
  assert.equal(current.status, "current");

  const outdated = derivePackRevisionStatus({
    authorityConfirmed: true,
    capability: { publishedPackId: "opaque-next-artifact" },
    pack: managedPack,
    provenanceMode: "remote_verified",
  });
  assert.equal(outdated.status, "outdated");
  assert.equal(outdated.publishedPackId, "opaque-next-artifact");

  const unverified = derivePackRevisionStatus({
    authorityConfirmed: true,
    capability: { publishedPackId: managedPack.packId },
    pack: managedPack,
    provenanceMode: "manual",
  });
  assert.equal(unverified.status, "current-unverified");

  for (const capability of [{}, { publishedPackId: null }, { publishedPackId: managedPack.packId }]) {
    const unknown = derivePackRevisionStatus({
      authorityConfirmed: capability.publishedPackId !== managedPack.packId,
      capability,
      pack: managedPack,
      provenanceMode: "remote_verified",
    });
    assert.equal(unknown.status, "unknown");
  }
});
