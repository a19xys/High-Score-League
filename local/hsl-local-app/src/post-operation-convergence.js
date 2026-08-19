const { isLauncherSnapshot } = require("./launcher-state-authority");

function isCompletedMameResult(result) {
  return Boolean(
    result?.mameSpawned === true
    && result?.phase === "mame-closed"
    && isLauncherSnapshot(result.state),
  );
}

async function publishPostMameConvergence(result, options = {}) {
  if (!isCompletedMameResult(result)) {
    return { published: false, reason: "not-completed-mame" };
  }

  const authority = options.authority;
  if (!authority?.reserveRevision || !authority?.acceptEffects || !authority?.publishSnapshot) {
    throw new TypeError("launcher state authority is required");
  }

  const revision = authority.reserveRevision();
  if (!authority.acceptEffects(revision)) {
    return { published: false, reason: "superseded", revision };
  }

  const isCurrent = () => authority.isEffectRevisionCurrent(revision);
  const preparedState = options.prepareState
    ? await options.prepareState(result.state, { isCurrent, revision })
    : result.state;
  if (!preparedState || !isCurrent()) {
    return { published: false, reason: "superseded", revision };
  }

  const snapshot = authority.publishSnapshot(preparedState, revision);
  options.publishSnapshot?.(snapshot, { revision });
  return { published: true, revision, snapshot };
}

module.exports = {
  isCompletedMameResult,
  publishPostMameConvergence,
};
