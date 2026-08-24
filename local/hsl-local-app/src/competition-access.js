const ACCESS_REASONS = Object.freeze({
  LOCAL_PACK: "local-pack-unavailable",
  LOCAL_CAPTURE: "local-capture-unavailable",
  LOCAL_INTEGRITY: "local-integrity-unavailable",
  PACK_UPDATE_REQUIRED: "pack-update-required",
  PACK_CURRENTNESS_UNKNOWN: "pack-currentness-unknown",
  PACK_PROVENANCE_UNVERIFIED: "pack-provenance-unverified",
  NO_ACCOUNT: "no-account",
  REQUIRES_LOGIN: "requires-login",
  MEMBERSHIP_NOT_MEMBER: "not-member",
  MEMBERSHIP_UNKNOWN: "membership-unknown",
  WEEK_INACTIVE: "week-inactive",
  WEEK_CLOSED: "week-closed",
  WEEK_UNLINKED: "week-unlinked",
  WEEK_UNKNOWN: "week-unknown",
  READY: "competition-ready",
});

function deriveCompetitionAccess({
  local = {},
  membership = {},
  session = {},
  week = {},
} = {}) {
  const canPractice = local.canPractice === true;
  const localCompetitionReady = canPractice
    && local.protectedCompetitionReady === true
    && local.hasCompetitionScope === true
    && local.hasWeek === true;
  const revisionManaged = local.revisionManaged === true;
  const revisionStatus = local.revisionStatus || "unknown";
  const hasStableIdentity = session.hasSession === true && Boolean(session.userId);
  const requiresLogin = session.requiresLogin === true;
  const membershipStatus = membership.effectiveStatus || membership.status || "unknown";
  const weekAuthorityState = week.authorityState || null;
  const weekStatus = week.fresh === false && weekAuthorityState !== "offline-durable" && weekAuthorityState !== "refreshing"
    ? "unknown"
    : week.publicState || "unknown";

  let reason = ACCESS_REASONS.READY;
  let reasonCategory = "ready";
  if (!canPractice) {
    reason = ACCESS_REASONS.LOCAL_PACK;
    reasonCategory = "local";
  } else if (revisionManaged && revisionStatus === "outdated") {
    reason = ACCESS_REASONS.PACK_UPDATE_REQUIRED;
    reasonCategory = "pack-revision";
  } else if (revisionManaged && revisionStatus === "unknown") {
    reason = ACCESS_REASONS.PACK_CURRENTNESS_UNKNOWN;
    reasonCategory = "pack-revision";
  } else if (revisionManaged && revisionStatus === "current-unverified") {
    reason = ACCESS_REASONS.PACK_PROVENANCE_UNVERIFIED;
    reasonCategory = "pack-revision";
  } else if (local.captureReady === false) {
    reason = ACCESS_REASONS.LOCAL_CAPTURE;
    reasonCategory = "local";
  } else if (local.protectedCompetitionReady !== true || local.hasCompetitionScope !== true || local.hasWeek !== true) {
    reason = ACCESS_REASONS.LOCAL_INTEGRITY;
    reasonCategory = "local";
  } else if (requiresLogin) {
    reason = ACCESS_REASONS.REQUIRES_LOGIN;
    reasonCategory = "session";
  } else if (!hasStableIdentity) {
    reason = ACCESS_REASONS.NO_ACCOUNT;
    reasonCategory = "session";
  } else if (membershipStatus === "not_member") {
    reason = ACCESS_REASONS.MEMBERSHIP_NOT_MEMBER;
    reasonCategory = "membership";
  } else if (membershipStatus !== "member") {
    reason = ACCESS_REASONS.MEMBERSHIP_UNKNOWN;
    reasonCategory = "membership";
  } else if (weekStatus === "inactive") {
    reason = ACCESS_REASONS.WEEK_INACTIVE;
    reasonCategory = "week";
  } else if (weekStatus === "closed") {
    reason = ACCESS_REASONS.WEEK_CLOSED;
    reasonCategory = "week";
  } else if (weekStatus === "unlinked") {
    reason = ACCESS_REASONS.WEEK_UNLINKED;
    reasonCategory = "week";
  } else if (weekStatus !== "active") {
    reason = ACCESS_REASONS.WEEK_UNKNOWN;
    reasonCategory = "week";
  }

  const canPlayCompetition = reason === ACCESS_REASONS.READY && localCompetitionReady;
  const canSubmitNow = canPlayCompetition
    && local.canSubmitLocally !== false
    && membership.canSubmit === true
    && session.remoteUsable === true;

  return {
    canPlayCompetition,
    canPractice,
    canSubmitNow,
    hasStableIdentity,
    membershipStatus,
    revisionManaged,
    revisionStatus,
    reason,
    reasonCategory,
    requiresLogin,
    weekAuthorityState,
    lastKnownWeekStatus: week.lastKnownPublicState || week.publicState || "unknown",
    weekStatus,
  };
}

module.exports = {
  ACCESS_REASONS,
  deriveCompetitionAccess,
};
