const { isRemotePackId } = require("./pack-deeplink");

const PACK_REVISION_STATUSES = Object.freeze({
  CURRENT: "current",
  OUTDATED: "outdated",
  CURRENT_UNVERIFIED: "current-unverified",
  UNKNOWN: "unknown",
});

function isRevisionManagedPack(pack = {}) {
  if (pack.revisionManaged === true) return true;
  return (pack.packVersion === 2 || pack.contract?.version === 2)
    && pack.contract?.mame?.profiles?.competition?.integrity?.version === 1;
}

function derivePackRevisionStatus(input = {}) {
  const revisionManaged = input.revisionManaged === true || isRevisionManagedPack(input.pack || {});
  if (!revisionManaged) {
    return Object.freeze({
      publishedPackId: null,
      publishedPackKnown: false,
      reason: "legacy-not-managed",
      revisionManaged: false,
      status: PACK_REVISION_STATUSES.CURRENT,
    });
  }

  const capability = input.capability || {};
  const publishedPackKnown = Object.hasOwn(capability, "publishedPackId")
    && (capability.publishedPackId === null || isRemotePackId(capability.publishedPackId));
  const authorityConfirmed = input.authorityConfirmed === true
    || capability.currentConclusive === true;
  const localPackId = input.localPackId || input.pack?.packId || null;
  const publishedPackId = publishedPackKnown ? capability.publishedPackId : null;

  if (!authorityConfirmed || !publishedPackKnown || !isRemotePackId(publishedPackId)) {
    return Object.freeze({
      publishedPackId,
      publishedPackKnown,
      reason: "currentness-unconfirmed",
      revisionManaged: true,
      status: PACK_REVISION_STATUSES.UNKNOWN,
    });
  }
  if (publishedPackId !== localPackId) {
    return Object.freeze({
      publishedPackId,
      publishedPackKnown: true,
      reason: "published-pack-differs",
      revisionManaged: true,
      status: PACK_REVISION_STATUSES.OUTDATED,
    });
  }
  const provenanceVerified = input.provenanceVerified === true || input.provenanceMode === "remote_verified";
  return Object.freeze({
    publishedPackId,
    publishedPackKnown: true,
    reason: provenanceVerified ? "current-verified" : "current-provenance-unverified",
    revisionManaged: true,
    status: provenanceVerified
      ? PACK_REVISION_STATUSES.CURRENT
      : PACK_REVISION_STATUSES.CURRENT_UNVERIFIED,
  });
}

module.exports = {
  PACK_REVISION_STATUSES,
  derivePackRevisionStatus,
  isRevisionManagedPack,
};
