function normalizeAttemptPart(value) {
  return value === undefined || value === null ? null : String(value);
}

function createCompetitionAttemptFingerprint(input = {}) {
  return {
    activeInstanceKey: normalizeAttemptPart(input.activeInstanceKey),
    packId: normalizeAttemptPart(input.packId),
    authorityKey: normalizeAttemptPart(input.authorityKey),
    origin: normalizeAttemptPart(input.origin),
    reachabilityGeneration: Number(input.reachabilityGeneration) || 0,
    userId: normalizeAttemptPart(input.userId),
    weekId: normalizeAttemptPart(input.weekId),
  };
}

function competitionAttemptFromState(state = {}, authority = {}) {
  return createCompetitionAttemptFingerprint({
    activeInstanceKey: state.selection?.activeInstanceKey,
    packId: state.activePack?.packId || state.game?.packId,
    authorityKey: authority.authorityKey,
    origin: authority.origin,
    reachabilityGeneration: authority.reachabilityGeneration,
    userId: state.session?.userId,
    weekId: state.game?.weekId || state.weekCapability?.weekId,
  });
}

function competitionAttemptFromLauncherContext(context = {}, authority = {}) {
  return createCompetitionAttemptFingerprint({
    activeInstanceKey: context.selection?.activeInstanceKey,
    packId: context.baseConfig?.pack?.packId,
    authorityKey: authority.authorityKey,
    origin: authority.origin,
    reachabilityGeneration: authority.reachabilityGeneration,
    userId: context.session?.userId,
    weekId: context.baseConfig?.defaultWeekId || context.baseConfig?.pack?.weekId || context.weekCapability?.weekId,
  });
}

function competitionAttemptsMatch(left, right) {
  return Boolean(left && right)
    && left.activeInstanceKey === right.activeInstanceKey
    && left.packId === right.packId
    && left.authorityKey === right.authorityKey
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

function competitionAccessMessage(reason, state = {}) {
  const title = state.game?.displayName || state.activePack?.title || "este juego";
  if (reason === "pack-update-required") return `Hay una nueva versión de ${title}. Actualiza el pack para competir.`;
  if (reason === "pack-currentness-unknown") return "Conéctate a High Score League para comprobar que el pack está actualizado.";
  if (reason === "pack-provenance-unverified") return "Verifica este pack desde High Score League para competir.";
  if (reason === "local-capture-unavailable") return "La captura competitiva local no está preparada.";
  if (reason === "local-integrity-unavailable") return "La integridad competitiva local no está preparada.";
  return state.readiness?.message || "No se puede jugar competición con este pack.";
}

async function runCompetitionPlayPreflight(options = {}) {
  const initialState = await options.getState();
  const initialAuthority = options.getAuthorityContext();
  const attempt = competitionAttemptFromState(initialState, initialAuthority);

  if (initialAuthority.connected !== true) {
    if (initialState.activePack?.revisionManaged === true || initialState.readiness?.revisionManaged === true) {
      return blockedResult(
        initialState,
        competitionAccessMessage("pack-currentness-unknown", initialState),
        undefined,
        "pack-currentness-unknown",
      );
    }
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
    const revisionManaged = initialState.activePack?.revisionManaged === true
      || initialState.readiness?.revisionManaged === true;
    return blockedResult(
      currentState,
      revisionManaged
        ? competitionAccessMessage("pack-currentness-unknown", currentState)
        : "No se pudo confirmar la semana activa.",
      revisionManaged
        ? undefined
        : "No se pudo confirmar que la semana siga activa. Puedes practicar.",
      revisionManaged ? "pack-currentness-unknown" : "week-refresh-failed",
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
    const reason = currentState.competitionAccess?.reason || "local-competition-not-ready";
    return blockedResult(
      currentState,
      "No se puede jugar competición con este pack.",
      competitionAccessMessage(reason, currentState),
      reason,
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
  competitionAccessMessage,
  confirmedCompetitionFromState,
  createCompetitionAttemptFingerprint,
  membershipResolutionBlocksCompetition,
  runCompetitionPlayPreflight,
  weekBlockMessage,
};
