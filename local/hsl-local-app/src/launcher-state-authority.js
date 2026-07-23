function isLauncherSnapshot(value) {
  return Boolean(value && typeof value === "object" && (
    Object.hasOwn(value, "library") ||
    Object.hasOwn(value, "session") ||
    Object.hasOwn(value, "selection")
  ));
}

function createLauncherStateAuthority() {
  let revision = 0;
  let publishedSnapshots = 0;

  function reserveRevision() {
    revision += 1;
    return revision;
  }

  function publishSnapshot(snapshot, reservedRevision = reserveRevision()) {
    if (!isLauncherSnapshot(snapshot)) return snapshot;
    const nextRevision = Number(reservedRevision);
    if (!Number.isSafeInteger(nextRevision) || nextRevision <= 0 || nextRevision > revision) {
      throw new TypeError("launcher state revision must be a reserved positive integer");
    }
    publishedSnapshots += 1;
    return Object.freeze({
      ...snapshot,
      launcherStateRevision: nextRevision,
    });
  }

  function publishResult(value, reservedRevision) {
    if (isLauncherSnapshot(value)) return publishSnapshot(value, reservedRevision);
    if (!value || typeof value !== "object" || !isLauncherSnapshot(value.state)) return value;
    return {
      ...value,
      state: publishSnapshot(value.state, reservedRevision),
    };
  }

  return {
    getDiagnostics() {
      return { currentRevision: revision, publishedSnapshots };
    },
    publishResult,
    publishSnapshot,
    reserveRevision,
  };
}

module.exports = {
  createLauncherStateAuthority,
  isLauncherSnapshot,
};
