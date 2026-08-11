const { DEFAULT_REMOTE_REQUEST_TIMEOUT_MS } = require("./remote-request");

const MAX_ATTEMPTED_IDENTITIES = 64;
const MAX_TERMINAL_CONTEXTS = 64;
const RETRYABLE_MEMBERSHIP_STATUSES = new Set(["error", "unknown"]);
const READINESS_SUMMARY_IGNORED_CHECKS = new Set(["membership", "session", "scope", "web-base-url"]);
const TERMINAL_INVALIDATION_REASONS = new Set([
  "import-pack",
  "login",
  "logout",
  "open-pack",
  "pack-change",
  "pack-directory-change",
  "pack-rescan",
  "remove-account",
]);

function activeAccountId(state = {}) {
  return state.accounts?.activeUserId
    || state.session?.userId
    || state.accounts?.knownAccounts?.find((account) => account.isActive)?.userId
    || null;
}

function membershipResolutionContext(state = {}) {
  const accountId = activeAccountId(state);
  const instanceKey = state.selection?.activeInstanceKey || state.game?.instanceKey || null;
  const weekId = state.game?.weekId || state.membership?.weekId || null;
  return {
    accountId,
    instanceKey,
    key: accountId && instanceKey && weekId ? [accountId, instanceKey, weekId].join("|") : null,
    sessionRevision: Number(state.session?.sessionRevision) || 0,
    weekId,
  };
}

function membershipExecutionKey(context, connection = {}) {
  return context?.key
    ? `${context.key}|${Number(connection.reachabilityGeneration) || 0}`
    : null;
}

function isInitialDeferredMembership(membership = {}) {
  return membership.revalidationRequired === true || (
    membership.status === "unknown"
    && membership.technicalReason === "deferred"
    && !membership.checkedAt
  );
}

function isRetryableMembership(membership = {}) {
  return membership.revalidationRequired === true
    || RETRYABLE_MEMBERSHIP_STATUSES.has(membership.status)
    || membership.authDeferred === true
    || ["cancelled", "timeout", "transport-failure"].includes(membership.remoteFailure);
}

function hasResolutionPrerequisites(state = {}, context = membershipResolutionContext(state)) {
  const configurationStatus = state.remoteConfiguration?.status;
  return Boolean(
    context.key
    && state.game
    && state.session?.hasSession === true
    && state.session?.requiresLogin !== true
    && !["invalid", "missing"].includes(configurationStatus)
  );
}

function membershipCheck(checks = [], patch) {
  let replaced = false;
  const next = checks.map((item) => {
    if (item.id !== "membership") return item;
    replaced = true;
    return { ...item, ...patch };
  });
  if (!replaced) next.push({ id: "membership", label: "Participacion", ...patch });
  return next;
}

function checkingReadiness(readiness = {}, preserveCompetition = false) {
  const message = "Comprobando participación.";
  const checks = membershipCheck(readiness.checks || [], {
    details: [],
    level: "warning",
    message,
  });
  return {
    ...readiness,
    blockers: (readiness.blockers || []).filter((item) => item !== message),
    canPlayCompetition: preserveCompetition && Boolean(readiness.canPlayCompetition),
    checks,
    message,
    status: "blocked",
    warnings: (readiness.warnings || []).filter((item) => item !== message),
  };
}

function checkingMembershipState(state, operation) {
  const requestActive = operation.stage === "request";
  const identity = {
    accountId: operation.context.accountId,
    connectionGeneration: operation.connectionGeneration,
    contextCurrent: true,
    generation: operation.generation,
    instanceKey: operation.context.instanceKey,
    weekId: operation.context.weekId,
  };
  const resolution = {
    ...identity,
    active: true,
    deadlineAt: operation.deadlineAt,
    stage: operation.stage,
    startedAt: operation.startedAt,
  };
  const preserveCompetition = (state.membership?.effectiveStatus || state.membership?.status) === "member";
  return {
    ...state,
    membership: {
      ...(state.membership || {}),
      authDeferred: false,
      canPlayCompetition: preserveCompetition && state.membership?.canPlayCompetition === true,
      canSubmit: false,
      checkedAt: null,
      generation: operation.generation,
      message: "Comprobando participacion.",
      remoteFailure: null,
      request: requestActive ? { ...identity, inFlight: true } : null,
      resolution,
      retryable: false,
      status: "checking",
      technicalReason: requestActive ? "membership-request-active" : "waiting-for-connectivity",
      weekId: operation.context.weekId,
    },
    readiness: checkingReadiness(state.readiness, preserveCompetition),
  };
}

function stableCompetitionGate(state = {}) {
  const readiness = state.readiness || {};
  const prerequisiteFailure = (readiness.checks || []).some((item) => (
    ["session", "scope"].includes(item.id) && item.level === "error"
  ));
  return hasResolutionPrerequisites(state)
    && readiness.canPractice !== false
    && readiness.canCapture !== false
    && !prerequisiteFailure;
}

function settledMembershipState(state, reason, nowIso = new Date().toISOString(), stableState = null) {
  const message = "No se pudo consultar la participación.";
  const membership = {
    ...(state.membership || {}),
    authDeferred: false,
    canPlayCompetition: (state.membership?.effectiveStatus || state.membership?.status) === "member"
      && state.membership?.canPlayCompetition === true,
    canSubmit: false,
    checkedAt: nowIso,
    generation: null,
    message,
    remoteFailure: reason === "timeout" ? "timeout" : reason === "suspend" ? "cancelled" : null,
    request: null,
    resolution: null,
    retryable: true,
    status: "error",
    technicalReason: `startup-membership:${reason}`,
  };
  const stateContext = membershipResolutionContext(state);
  const stableContext = membershipResolutionContext(stableState || {});
  const compatibleStableState = stableState
    && stateContext.key
    && stableContext.key === stateContext.key
    ? stableState
    : null;
  const stableReference = compatibleStableState || {
    ...state,
    readiness: {
      ...(state.readiness || {}),
      canPlayCompetition: stableCompetitionGate(state),
    },
  };
  return {
    ...state,
    membership,
    readiness: mergeMembershipReadiness(state, {
      membership,
      membershipCheck: {
        details: [],
        id: "membership",
        label: "Participacion",
        level: "warning",
        message,
      },
    }, stableReference),
  };
}

function cloneMembershipCheck(check) {
  return check ? {
    ...check,
    details: Array.isArray(check.details) ? [...check.details] : check.details,
    technicalDetails: Array.isArray(check.technicalDetails) ? [...check.technicalDetails] : check.technicalDetails,
  } : null;
}

function defaultMembershipCheck(membership = {}) {
  if (membership.status === "member") {
    return { id: "membership", label: "Participacion", level: "ok", message: "Participas en la temporada." };
  }
  if (membership.status === "unknown" || membership.status === "error") {
    return {
      id: "membership",
      label: "Participacion",
      level: "warning",
      message: membership.message || "No se pudo comprobar la participacion.",
    };
  }
  return {
    id: "membership",
    label: "Participacion",
    level: "error",
    message: membership.message || "No participas en esta temporada.",
  };
}

function membershipOutcomeFromState(state = {}, executionKey = null) {
  const membership = {
    ...(state.membership || {}),
    request: null,
    resolution: null,
  };
  const check = (state.readiness?.checks || []).find((item) => item.id === "membership");
  return {
    executionKey,
    membership,
    membershipCheck: cloneMembershipCheck(check || defaultMembershipCheck(membership)),
  };
}

function membershipAllowsCompetition(membership = {}) {
  return (membership.effectiveStatus || membership.status) === "member";
}

function readinessTitle(status) {
  if (status === "ready") return "Listo para jugar";
  if (status === "warning") return "Listo con avisos";
  return "Requiere atencion";
}

function readinessMessage({ blockers, canPlayCompetition, canPractice, canSubmit, status }) {
  if (blockers.length > 0) return blockers[0];
  if (status === "warning") {
    return canPlayCompetition && !canSubmit
      ? "Puedes jugar, pero la subida automatica no esta lista todavia."
      : "Puedes usar el pack, pero hay avisos que conviene revisar.";
  }
  if (canPlayCompetition && canPractice && canSubmit) {
    return "Puedes practicar, competir y sincronizar puntuaciones.";
  }
  return "No se pudo determinar si el pack esta listo.";
}

function mergeMembershipReadiness(state, outcome, resultState = null) {
  const readiness = state.readiness;
  if (!readiness || typeof readiness !== "object") return readiness;

  const stateContext = membershipResolutionContext(state);
  const resultContext = membershipResolutionContext(resultState || {});
  const compatibleResultState = stateContext.key && resultContext.key === stateContext.key
    ? resultState
    : null;
  const previousMembership = state.membership || {};
  const membership = outcome.membership || {};
  const checks = membershipCheck(readiness.checks || [], outcome.membershipCheck || defaultMembershipCheck(membership));
  const blockers = checks.filter((item) => item.level === "error").map((item) => item.message);
  const warnings = checks.filter((item) => item.level === "warning").map((item) => item.message);
  const membershipAllowed = membershipAllowsCompetition(membership);
  let canPlayCompetition = false;
  if (membershipAllowed) {
    if (membershipAllowsCompetition(previousMembership)) {
      canPlayCompetition = Boolean(readiness.canPlayCompetition);
    } else if (typeof compatibleResultState?.readiness?.canPlayCompetition === "boolean") {
      canPlayCompetition = compatibleResultState.readiness.canPlayCompetition;
    } else {
      canPlayCompetition = Boolean(readiness.canPractice);
    }
  }
  canPlayCompetition = canPlayCompetition && readiness.canPractice !== false;

  const submitPrerequisiteFailure = checks.some((item) => (
    ["session", "scope", "web-base-url"].includes(item.id) && item.level === "error"
  ));
  const canSubmit = membership.canSubmit === true && !submitPrerequisiteFailure;
  const structuralBlocker = checks.some((item) => (
    item.level === "error" && !READINESS_SUMMARY_IGNORED_CHECKS.has(item.id)
  ));
  const status = readiness.canPractice === false || structuralBlocker
    ? "blocked"
    : warnings.length > 0 || !canSubmit
      ? "warning"
      : "ready";

  return {
    ...readiness,
    blockers,
    canPlayCompetition,
    canSubmit,
    checks,
    message: readinessMessage({
      blockers,
      canPlayCompetition,
      canPractice: readiness.canPractice,
      canSubmit,
      status,
    }),
    status,
    title: readinessTitle(status),
    warnings,
  };
}

function mergeMembershipOutcome(state, outcome, resultState = null) {
  return {
    ...state,
    membership: { ...(outcome.membership || {}) },
    readiness: mergeMembershipReadiness(state, outcome, resultState),
  };
}

function createMembershipStartupCoordinator(options = {}) {
  const getConnection = options.getConnectivityState || (() => ({}));
  const now = options.now || Date.now;
  const queueTask = options.queueTask || ((task) => queueMicrotask(task));
  const scheduleTimeout = options.setTimeout || setTimeout;
  const cancelTimeout = options.clearTimeout || clearTimeout;
  const remoteTimeoutMs = Number.isFinite(options.remoteTimeoutMs)
    ? Math.max(0, options.remoteTimeoutMs)
    : DEFAULT_REMOTE_REQUEST_TIMEOUT_MS;
  const connectivityTimeoutMs = Number.isFinite(options.connectivityTimeoutMs)
    ? Math.max(0, options.connectivityTimeoutMs)
    : 3000;
  let active = null;
  let currentState = null;
  let latestSnapshot = null;
  let observationSequence = 0;
  let runSequence = 0;
  let stopped = false;
  const attempted = new Set();
  const terminals = new Map();
  const diagnostics = {
    aborted: 0,
    completed: 0,
    discarded: 0,
    requests: 0,
    scheduled: 0,
  };

  const nowIso = () => new Date(now()).toISOString();

  function deleteAttempt(key) {
    if (key) attempted.delete(key);
  }

  function recordAttempt(key) {
    if (!key) return;
    attempted.delete(key);
    attempted.add(key);
    while (attempted.size > MAX_ATTEMPTED_IDENTITIES) {
      attempted.delete(attempted.values().next().value);
    }
  }

  function publish(state, phase, revision) {
    if (revision) options.publish?.(state, { phase, revision });
  }

  function rememberTerminal(state, executionKey = null) {
    const context = membershipResolutionContext(state);
    if (!context.key || state.membership?.status === "checking" || isInitialDeferredMembership(state.membership)) return null;
    const terminal = {
      contextKey: context.key,
      ...membershipOutcomeFromState(state, executionKey),
    };
    terminals.delete(context.key);
    terminals.set(context.key, terminal);
    while (terminals.size > MAX_TERMINAL_CONTEXTS) {
      const oldestKey = terminals.keys().next().value;
      const oldest = terminals.get(oldestKey);
      terminals.delete(oldestKey);
      deleteAttempt(oldest?.executionKey);
    }
    return terminal;
  }

  function terminalFor(context) {
    if (!context?.key || !terminals.has(context.key)) return null;
    const terminal = terminals.get(context.key);
    terminals.delete(context.key);
    terminals.set(context.key, terminal);
    return terminal;
  }

  function forgetTerminal(context) {
    if (!context?.key) return;
    const terminal = terminals.get(context.key);
    terminals.delete(context.key);
    deleteAttempt(terminal?.executionKey);
    for (const executionKey of attempted) {
      if (executionKey.startsWith(`${context.key}|`)) attempted.delete(executionKey);
    }
  }

  function restoreTerminal(state, context) {
    const terminal = terminalFor(context);
    return terminal ? mergeMembershipOutcome(state, terminal) : state;
  }

  function clearDeadline(run) {
    if (!run || run.deadlineHandle === null) return;
    cancelTimeout(run.deadlineHandle);
    run.deadlineHandle = null;
    run.deadlinePhase = null;
  }

  function armDeadline(run, timeoutMs, phase) {
    clearDeadline(run);
    run.deadlineAt = new Date(now() + timeoutMs).toISOString();
    run.deadlinePhase = phase;
    run.deadlineHandle = scheduleTimeout(() => {
      if (active !== run || run.deadlinePhase !== phase || stopped) return;
      active = null;
      clearDeadline(run);
      deleteAttempt(run.executionKey);
      diagnostics.aborted += 1;
      run.controller?.abort("timeout");

      const context = membershipResolutionContext(latestSnapshot || {});
      if (context.key !== run.context.key) {
        diagnostics.discarded += 1;
        currentState = latestSnapshot;
        return;
      }

      const baseState = latestSnapshot || run.baseState;
      const settled = settledMembershipState(baseState, "timeout", nowIso(), run.baseState);
      currentState = settled;
      rememberTerminal(settled, run.executionKey || membershipExecutionKey(run.context, getConnection()));
      diagnostics.completed += 1;
      publish(settled, "settled", run.finalRevision);
    }, timeoutMs);
    run.deadlineHandle?.unref?.();
  }

  function cancelActive(reason) {
    if (!active) return null;
    const cancelled = active;
    active = null;
    clearDeadline(cancelled);
    deleteAttempt(cancelled.executionKey);
    diagnostics.aborted += 1;
    cancelled.controller?.abort(reason);
    return cancelled;
  }

  function stableStateAfterCancellation(run) {
    const baseState = latestSnapshot || run?.baseState || currentState;
    if (!baseState) return null;
    const context = membershipResolutionContext(baseState);
    const terminal = terminalFor(context);
    if (terminal) return mergeMembershipOutcome(baseState, terminal, run?.baseState);
    if (baseState.membership?.status === "checking") {
      return settledMembershipState(baseState, "cancelled", nowIso(), run?.baseState);
    }
    return baseState;
  }

  function publishSettled(run, reason) {
    if (!run || stopped) return null;
    const latestContext = membershipResolutionContext(latestSnapshot || currentState || {});
    if (latestContext.key !== run.context.key) return null;
    const baseState = latestSnapshot || run.baseState;
    const terminal = terminalFor(run.context);
    const settled = terminal
      ? mergeMembershipOutcome(baseState, terminal, run.baseState)
      : settledMembershipState(baseState, reason, nowIso(), run.baseState);
    currentState = settled;
    rememberTerminal(settled, run.executionKey || membershipExecutionKey(run.context, getConnection()));
    publish(settled, "settled", run.finalRevision);
    return settled;
  }

  function runContextIsCurrent(run) {
    const context = membershipResolutionContext(latestSnapshot || {});
    const connection = getConnection();
    return !stopped
      && active === run
      && context.key === run.context.key
      && connection.reachability === "connected"
      && Number(connection.reachabilityGeneration) === Number(run.connectionGeneration);
  }

  function discardRemote(run) {
    diagnostics.discarded += 1;
    if (active !== run) return;
    active = null;
    clearDeadline(run);
    deleteAttempt(run.executionKey);
    currentState = stableStateAfterCancellation(run);
  }

  function finishRemote(run, result) {
    const resultContext = membershipResolutionContext(result || {});
    if (!runContextIsCurrent(run)) {
      discardRemote(run);
      return;
    }
    if (resultContext.key !== run.context.key
      || (result?.membership?.weekId && result.membership.weekId !== run.context.weekId)
      || !result?.membership
      || result.membership.status === "checking"
      || isInitialDeferredMembership(result.membership)) {
      failRemote(run, "stale-result");
      return;
    }

    active = null;
    clearDeadline(run);
    const outcome = membershipOutcomeFromState(result, run.executionKey);
    const baseState = observationSequence === run.observationSequence ? result : latestSnapshot;
    const merged = mergeMembershipOutcome(baseState || result, outcome, result);
    currentState = merged;
    rememberTerminal(merged, run.executionKey);
    diagnostics.completed += 1;
    publish(merged, "result", run.finalRevision);
  }

  function failRemote(run, reason = "operation-error") {
    if (!runContextIsCurrent(run)) {
      discardRemote(run);
      return;
    }
    active = null;
    clearDeadline(run);
    const settled = settledMembershipState(latestSnapshot || run.baseState, reason, nowIso(), run.baseState);
    currentState = settled;
    rememberTerminal(settled, run.executionKey);
    diagnostics.completed += 1;
    publish(settled, "result", run.finalRevision);
  }

  function publishChecking(run) {
    if (!run || run.checkingPublished || active !== run || stopped) return;
    run.checkingPublished = true;
    publish(currentState, "checking", run.checkingRevision);
  }

  function startRemote(expectedGeneration) {
    const run = active;
    const connection = getConnection();
    if (!run || run.generation !== expectedGeneration || stopped) return;
    if (run.stage === "request") return;
    if (connection.reachability !== "connected") return;

    const executionKey = membershipExecutionKey(run.context, connection);
    if (!executionKey || attempted.has(executionKey)) {
      const cancelled = cancelActive("duplicate");
      currentState = stableStateAfterCancellation(cancelled);
      return;
    }
    recordAttempt(executionKey);
    run.connectionGeneration = Number(connection.reachabilityGeneration) || 0;
    run.controller = new AbortController();
    run.executionKey = executionKey;
    run.stage = "request";
    armDeadline(run, remoteTimeoutMs, "remote");
    currentState = checkingMembershipState(latestSnapshot || run.baseState, run);
    diagnostics.requests += 1;
    publishChecking(run);

    Promise.resolve()
      .then(() => options.execute?.({
        connectionGeneration: run.connectionGeneration,
        context: { ...run.context },
        generation: run.generation,
        signal: run.controller.signal,
        trigger: run.trigger,
      }))
      .then(
        (result) => finishRemote(run, result),
        () => failRemote(run),
      );
  }

  function begin(state, context, connection, trigger, { force = false } = {}) {
    if (active?.context.key === context.key) {
      currentState = checkingMembershipState(latestSnapshot || state, active);
      return currentState;
    }
    const cancelled = cancelActive("context-change");
    if (cancelled) currentState = stableStateAfterCancellation(cancelled);
    const executionKey = membershipExecutionKey(context, connection);
    if (!force && connection.reachability === "connected" && attempted.has(executionKey)) {
      return restoreTerminal(state, context);
    }
    if (force) deleteAttempt(executionKey);

    const generation = ++runSequence;
    const startedAt = nowIso();
    const checkingRevision = options.reserveRevision?.();
    const finalRevision = options.reserveRevision?.();
    active = {
      baseState: state,
      checkingPublished: false,
      checkingRevision,
      connectionGeneration: Number(connection.reachabilityGeneration) || 0,
      context,
      controller: null,
      deadlineAt: null,
      deadlineHandle: null,
      deadlinePhase: null,
      executionKey: null,
      finalRevision,
      generation,
      observationSequence,
      stage: connection.reachability === "connected" ? "scheduled" : "waiting-connectivity",
      startedAt,
      trigger,
    };
    diagnostics.scheduled += 1;
    armDeadline(active, connectivityTimeoutMs, "connectivity");
    currentState = checkingMembershipState(state, active);
    if (connection.reachability === "connected") {
      try {
        queueTask(() => startRemote(generation));
      } catch {
        failRemote(active);
      }
    }
    return currentState;
  }

  function observeState(state, trigger = "snapshot") {
    if (!state || stopped) return state;
    const previousState = currentState;
    observationSequence += 1;
    latestSnapshot = state;
    const connection = getConnection();
    const context = membershipResolutionContext(state);
    if (active && active.context.key !== context.key) {
      const cancelled = cancelActive("context-change");
      currentState = stableStateAfterCancellation(cancelled);
    }

    let deferred = isInitialDeferredMembership(state.membership);
    let nextState = deferred ? restoreTerminal(state, context) : state;
    if (!active && state.membership?.status === "checking") {
      const terminal = terminalFor(context);
      nextState = terminal
        ? mergeMembershipOutcome(state, terminal, previousState)
        : settledMembershipState(state, "orphaned-checking", nowIso(), previousState);
      latestSnapshot = nextState;
      deferred = false;
    }
    currentState = nextState;

    if (!hasResolutionPrerequisites(state, context)) {
      if (active) {
        const cancelled = cancelActive("prerequisites-unavailable");
        currentState = stableStateAfterCancellation(cancelled);
      }
      if (!deferred && state.membership?.status !== "checking") {
        rememberTerminal(nextState, membershipExecutionKey(context, connection));
      }
      return currentState;
    }

    if (active?.context.key === context.key) {
      if (!deferred && state.membership?.status !== "checking") {
        cancelActive("authoritative-membership");
        rememberTerminal(state, membershipExecutionKey(context, connection));
        currentState = state;
        return state;
      }
      if (deferred) active.baseState = state;
      active.finalRevision = options.reserveRevision?.() || active.finalRevision;
      currentState = checkingMembershipState(state, active);
      return currentState;
    }

    if (!deferred) {
      if (state.membership?.status !== "checking") {
        rememberTerminal(nextState, membershipExecutionKey(context, connection));
      }
      return nextState;
    }

    if (!isInitialDeferredMembership(nextState.membership)) {
      return nextState;
    }
    if (connection.activity === "suspended") return nextState;
    if (connection.reachability === "offline") {
      const settled = settledMembershipState(state, "connectivity-offline", nowIso());
      currentState = settled;
      rememberTerminal(settled, membershipExecutionKey(context, connection));
      return settled;
    }
    if (connection.reachability === "connected" || connection.probe?.inFlight === true) {
      return begin(state, context, connection, trigger);
    }
    return nextState;
  }

  function updateConnectivity(connection, trigger = "connectivity") {
    if (!currentState || stopped) return;

    if (active) {
      if (connection.activity === "suspended") {
        const run = cancelActive("suspend");
        publishSettled(run, "suspend");
        return;
      }
      if (connection.reachability === "offline") {
        const run = cancelActive("connectivity-offline");
        run.executionKey ||= membershipExecutionKey(run.context, connection);
        publishSettled(run, "connectivity-offline");
        return;
      }
      if (connection.reachability === "connected") {
        if (active.stage === "request"
          && Number(connection.reachabilityGeneration) !== Number(active.connectionGeneration)) {
          const previous = cancelActive("connectivity-generation-change");
          currentState = stableStateAfterCancellation(previous);
          const context = membershipResolutionContext(latestSnapshot || currentState);
          if (hasResolutionPrerequisites(latestSnapshot || currentState, context)) {
            currentState = begin(latestSnapshot || currentState, context, connection, trigger, { force: true });
            publishChecking(active);
          }
        } else if (active.stage !== "request") {
          try {
            queueTask(() => startRemote(active?.generation));
          } catch {
            failRemote(active);
          }
        }
      } else if (connection.probe?.inFlight !== true) {
        const run = cancelActive("connectivity-unresolved");
        publishSettled(run, "connectivity-unresolved");
      }
      return;
    }

    const baseState = latestSnapshot || currentState;
    const context = membershipResolutionContext(baseState);
    if (connection.reachability !== "connected" || !hasResolutionPrerequisites(baseState, context)) return;
    const executionKey = membershipExecutionKey(context, connection);
    const terminal = terminalFor(context);
    const terminalRetry = terminal
      && isRetryableMembership(terminal.membership)
      && terminal.executionKey !== executionKey;
    const initialResolution = !terminal && isInitialDeferredMembership(baseState.membership);
    if (initialResolution || terminalRetry) {
      currentState = begin(baseState, context, connection, trigger, { force: Boolean(terminalRetry) });
      publishChecking(active);
    }
  }

  return {
    getCurrentState: () => currentState,
    getDiagnostics: () => ({
      ...diagnostics,
      active: Boolean(active),
      attempted: attempted.size,
      context: active?.context.key ? "active" : terminals.size > 0 ? "terminal" : "none",
      stage: active?.stage || "idle",
      stopped,
      terminals: terminals.size,
      timerActive: Boolean(active?.deadlineHandle !== null && active?.deadlineHandle !== undefined),
    }),
    invalidate(reason = "context-change", { publishStable = false } = {}) {
      const run = cancelActive(reason);
      if (run) {
        currentState = stableStateAfterCancellation(run);
        if (publishStable) publishSettled(run, reason);
      }
      if (TERMINAL_INVALIDATION_REASONS.has(reason)) {
        forgetTerminal(membershipResolutionContext(currentState || latestSnapshot || {}));
      }
      return currentState;
    },
    isActive: () => Boolean(active),
    observeState,
    resume(trigger = "resume") {
      if (!currentState || stopped || active) return currentState;
      const connection = getConnection();
      const baseState = latestSnapshot || currentState;
      const context = membershipResolutionContext(baseState);
      if (connection.reachability !== "connected" || !hasResolutionPrerequisites(baseState, context)) return currentState;
      const effectiveMembership = currentState.membership || baseState.membership;
      if (!isInitialDeferredMembership(effectiveMembership) && !isRetryableMembership(effectiveMembership)) return currentState;
      currentState = begin(baseState, context, connection, trigger, { force: true });
      publishChecking(active);
      return currentState;
    },
    shutdown(reason = "shutdown") {
      stopped = true;
      cancelActive(reason);
      attempted.clear();
      terminals.clear();
      latestSnapshot = null;
      currentState = null;
    },
    updateConnectivity,
  };
}

module.exports = {
  checkingMembershipState,
  createMembershipStartupCoordinator,
  hasResolutionPrerequisites,
  isInitialDeferredMembership,
  isRetryableMembership,
  membershipExecutionKey,
  membershipResolutionContext,
  settledMembershipState,
};
