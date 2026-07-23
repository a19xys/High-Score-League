export function createLauncherStateGate(options = {}) {
  let highestRevision = null;
  let legacyAccepted = false;
  let staleSnapshotsIgnored = 0;
  let legacySnapshotsIgnored = 0;

  function reject(reason, revision = null) {
    staleSnapshotsIgnored += 1;
    if (reason === "legacy-after-versioned" || reason === "duplicate-legacy") {
      legacySnapshotsIgnored += 1;
    }
    options.onReject?.({ reason, revision });
    return { accepted: false, reason, revision };
  }

  return {
    accept(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return reject("invalid-snapshot");
      const revision = Number(snapshot.launcherStateRevision);
      const versioned = Number.isSafeInteger(revision) && revision > 0;

      if (!versioned) {
        if (highestRevision !== null) return reject("legacy-after-versioned");
        if (legacyAccepted) return reject("duplicate-legacy");
        legacyAccepted = true;
        return { accepted: true, legacy: true, reason: "first-legacy", revision: null, snapshot };
      }

      if (highestRevision !== null && revision <= highestRevision) {
        return reject(revision === highestRevision ? "equal-revision" : "stale-revision", revision);
      }

      highestRevision = revision;
      return { accepted: true, legacy: false, reason: "newer-revision", revision, snapshot };
    },
    getDiagnostics() {
      return {
        highestRevision,
        legacySnapshotsIgnored,
        staleSnapshotsIgnored,
      };
    },
  };
}
