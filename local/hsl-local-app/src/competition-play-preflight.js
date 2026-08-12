function normalizeAttemptPart(value) {
  return value === undefined || value === null ? null : String(value);
}

function createCompetitionAttemptFingerprint(input = {}) {
  return {
    activeInstanceKey: normalizeAttemptPart(input.activeInstanceKey),
    deploymentKey: normalizeAttemptPart(input.deploymentKey),
    origin: normalizeAttemptPart(input.origin),
    reachabilityGeneration: Number(input.reachabilityGeneration) || 0,
    userId: normalizeAttemptPart(input.userId),
    weekId: normalizeAttemptPart(input.weekId),
  };
}

function competitionAttemptFromState(state = {}, authority = {}) {
  return createCompetitionAttemptFingerprint({
    activeInstanceKey: state.selection?.activeInstanceKey,
    deploymentKey: authority.deploymentKey,
    origin: authority.origin,
    reachabilityGeneration: authority.reachabilityGeneration,
    userId: state.session?.userId,
    weekId: state.game?.weekId || state.weekCapability?.weekId,
  });
}

function competitionAttemptFromLauncherContext(context = {}, authority = {}) {
  return createCompetitionAttemptFingerprint({
    activeInstanceKey: context.selection?.activeInstanceKey,
    deploymentKey: authority.deploymentKey,
    origin: authority.origin,
    reachabilityGeneration: authority.reachabilityGeneration,
    userId: context.session?.userId,
    weekId: context.baseConfig?.defaultWeekId || context.baseConfig?.pack?.weekId || context.weekCapability?.weekId,
  });
}

function competitionAttemptsMatch(left, right) {
  return Boolean(left && right)
    && left.activeInstanceKey === right.activeInstanceKey
    && left.deploymentKey === right.deploymentKey
    && left.origin === right.origin
    && left.reachabilityGeneration === right.reachabilityGeneration
    && left.userId === right.userId
    && left.weekId === right.weekId;
}

function blockedResult(state, summary, line = summary, reason = "competition-blocked", metadata = {}) {
  return {
    action: "play-competition",
    launchAttempted: false,
    lines: [line],
    mameSpawned: false,
    ok: false,
    phase: "preflight-rejected",
    reason,
    state,
    summary,
    ...metadata,
  };
}

function confirmedCompetitionFromState(state = {}) {
  return {
    competitionAccess: state.competitionAccess || null,
    membership: state.membership || null,
    weekCapability: state.weekCapability || state.game?.weekCapability || null,
  };
}

function membershipResolutionBlocksCompetition(state = {}, resolutionActive = false) {
  if (!resolutionActive) return false;
  return state.competitionAccess?.canPlayCompetition !== true
    && state.readiness?.canPlayCompetition !== true;
}

function weekBlockMessage(publicState) {
  if (publicState === "closed") return "La semana está cerrada. Puedes practicar.";
  if (publicState === "inactive") return "La semana todavía no está activa. Puedes practicar.";
  if (publicState === "unlinked") return "El pack no está vinculado a una semana pública. Puedes practicar.";
  return "No se pudo confirmar que la semana siga activa. Puedes practicar.";
}

async function runCompetitionPlayPreflight(options = {}) {
  const initialState = await options.getState();
  const initialAuthority = options.getAuthorityContext();
  const attempt = competitionAttemptFromState(initialState, initialAuthority);

  if (initialAuthority.connected !== true) {
    return options.launch({
      confirmedCompetition: confirmedCompetitionFromState(initialState),
      expectedCompetitionAttempt: attempt,
    });
  }

  if (!attempt.weekId) {
    return blockedResult(initialState, "No se puede jugar competición con este pack.", undefined, "local-competition-not-ready");
  }

  const remote = await options.ensureFreshCapability(attempt.weekId);
  const currentState = await options.getState();
  const currentAuthority = options.getAuthorityContext();
  const currentAttempt = competitionAttemptFromState(currentState, currentAuthority);

  if (!competitionAttemptsMatch(attempt, currentAttempt)) {
    return blockedResult(
      currentState,
      "El contexto competitivo ha cambiado.",
      "La cuenta, el pack o la conexión han cambiado. Vuelve a intentarlo.",
      "competition-context-changed",
    );
  }

  if (!remote?.ok) {
    const cause = String(remote?.reason || "temporary-failure");
    return blockedResult(
      currentState,
      "No se pudo confirmar la semana activa.",
      "No se pudo confirmar que la semana siga activa. Puedes practicar.",
      "week-refresh-failed",
      {
        cause,
        technicalDetails: ["week-refresh-failed", `cause=${cause}`],
      },
    );
  }

  const publicState = currentState.weekCapability?.publicState;
  if (publicState !== "active") {
    return blockedResult(currentState, weekBlockMessage(publicState), undefined, `week-${publicState || "unknown"}`);
  }

  if (currentState.competitionAccess?.canPlayCompetition !== true) {
    return blockedResult(
      currentState,
      "No se puede jugar competición con este pack.",
      currentState.readiness?.message || "No se puede jugar competición con este pack.",
      currentState.competitionAccess?.reason || "local-competition-not-ready",
    );
  }

  return options.launch({
    confirmedCompetition: confirmedCompetitionFromState(currentState),
    expectedCompetitionAttempt: currentAttempt,
  });
}

module.exports = {
  competitionAttemptFromLauncherContext,
  competitionAttemptFromState,
  competitionAttemptsMatch,
  confirmedCompetitionFromState,
  createCompetitionAttemptFingerprint,
  membershipResolutionBlocksCompetition,
  runCompetitionPlayPreflight,
  weekBlockMessage,
};
