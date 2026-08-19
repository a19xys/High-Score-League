import { getRankingActionState } from "./ranking-state.js";
import { deriveRemoteAvailability } from "./remote-availability.js";

export const PRESENTATION_SEVERITIES = Object.freeze({
  neutral: Object.freeze({ icon: "info", priority: 10 }),
  info: Object.freeze({ icon: "info", priority: 20 }),
  progress: Object.freeze({ icon: "refresh", priority: 30 }),
  success: Object.freeze({ icon: "check", priority: 40 }),
  warning: Object.freeze({ icon: "warning", priority: 60 }),
  error: Object.freeze({ icon: "error", priority: 80 }),
  blocked: Object.freeze({ icon: "error", priority: 90 }),
});

function presentation(domain, status, severity, title, description, extra = {}) {
  const semantic = PRESENTATION_SEVERITIES[severity] || PRESENTATION_SEVERITIES.neutral;
  return {
    domain,
    status,
    severity,
    title,
    description,
    icon: extra.icon || semantic.icon,
    priority: extra.priority ?? semantic.priority,
    ...extra,
  };
}

function remoteConfigurationProblem(remoteConfiguration) {
  const status = remoteConfiguration?.status;
  if (status === "invalid") {
    return presentation(
      "remote-configuration",
      "invalid",
      "blocked",
      "Configuración HSL inválida",
      "Las funciones en línea no están disponibles hasta corregir la configuración.",
    );
  }
  if (status === "missing") {
    return presentation(
      "remote-configuration",
      "missing",
      "blocked",
      "HSL sin configurar",
      "Las funciones en línea no están disponibles porque falta la configuración remota.",
    );
  }
  return null;
}

function connectivityStatus(connectivity) {
  const reachability = connectivity?.reachability;
  const displayStatus = connectivity?.displayStatus;
  const inFlight = connectivity?.probe?.inFlight === true;
  const phase = connectivity?.probe?.phase;

  if (connectivity?.activity === "suspended") return "suspended";
  if (reachability === "connected" && phase === "background") return "connected";
  if (displayStatus === "connected" && reachability === "connected") return "connected";
  if (displayStatus === "offline" && reachability === "offline") return "offline";
  if (["connecting", "reconnecting"].includes(displayStatus)) return displayStatus;
  if (inFlight && reachability === "connected") return "reconnecting";
  if (inFlight && reachability === "offline") return "reconnecting";
  if (inFlight) return "checking";
  if (reachability === "connected") return "connected";
  if (reachability === "offline") return "offline";
  if (connectivity?.reason && connectivity.reason !== "missing-hsl-origin") return "probe-error";
  return "unknown";
}

export function deriveConnectivityPresentation(connectivity, remoteConfiguration = null) {
  const configuration = remoteConfigurationProblem(remoteConfiguration);
  if (configuration) return configuration;

  const status = connectivityStatus(connectivity);
  const models = {
    unknown: ["neutral", "Conexión sin comprobar", "Todavía no se ha confirmado la conexión con High Score League."],
    checking: ["progress", "Comprobando conexión", "El launcher está comprobando la conexión con High Score League."],
    connecting: ["progress", "Comprobando conexión", "El launcher está comprobando la conexión con High Score League."],
    connected: ["success", "Conectado", "La conexión con High Score League está confirmada."],
    reconnecting: ["progress", "Reconectando", "El launcher está intentando recuperar la conexión."],
    offline: ["warning", "Sin conexión", "Puedes seguir practicando. Las puntuaciones guardadas permanecen seguras en este dispositivo."],
    suspended: ["neutral", "Comprobación en pausa", "La conexión volverá a comprobarse al reanudar el launcher."],
    "probe-error": ["warning", "No se pudo comprobar la conexión", "El launcher volverá a intentarlo; las puntuaciones locales permanecen seguras."],
  };
  const [severity, title, description] = models[status] || models.unknown;
  return presentation("connectivity", status === "connecting" ? "checking" : status, severity, title, description, {
    confirmed: status === "connected" && connectivity?.reachability === "connected",
    silent: connectivity?.probe?.phase === "background" && connectivity?.probe?.inFlight === true,
  });
}

export function derivePublicConnectivityPresentation(connectivity, remoteConfiguration = null) {
  const configurationUnavailable = ["invalid", "missing"].includes(remoteConfiguration?.status);
  const connected = !configurationUnavailable && connectivity?.reachability === "connected";
  const committed = configurationUnavailable || ["connected", "offline"].includes(connectivity?.reachability);
  return presentation(
    "connectivity",
    connected ? "connected" : "disconnected",
    connected ? "success" : "error",
    connected ? "Conectado" : "Desconectado",
    connected
      ? "La conexión con High Score League está confirmada."
      : "La conexión con High Score League no está confirmada.",
    { committed, confirmed: connected },
  );
}

const AUTO_RECOVERABLE_SESSION_STATUSES = new Set([
  "cancelled",
  "deferred",
  "lock-timeout",
  "refreshing",
  "stale",
  "storage-unavailable",
  "temporary-failure",
]);

function isNonActionableStoredSession(session = {}) {
  return session.hasSession === true
    && session.requiresLogin !== true
    && session.shouldRetry !== false
    && session.terminal !== true
    && AUTO_RECOVERABLE_SESSION_STATUSES.has(session.status);
}

export function deriveSessionPresentation(session = {}, accounts = {}, operation = {}) {
  session = session || {};
  accounts = accounts || {};
  operation = operation || {};
  if (operation.busy && operation.busyLabel === "Cambiando cuenta") {
    return presentation("session", "switching", "progress", "Cambiando cuenta", "La cuenta activa se está actualizando.", { actionRequired: false });
  }
  if (session.requiresLogin === true) {
    return presentation("session", "requires-login", "blocked", "Vuelve a iniciar sesión", "La cuenta sigue recordada, pero necesita autenticarse de nuevo.", { actionRequired: true });
  }
  if (isNonActionableStoredSession(session)) {
    return presentation("session", "active", "success", "Sesión activa", "La cuenta dispone de una sesión local válida.", {
      actionRequired: false,
      recoveryPending: true,
      technicalStatus: session.status,
    });
  }
  if (session.status === "error") {
    return presentation("session", "error", "error", "No se pudo leer la sesión", "Vuelve a intentarlo o inicia sesión de nuevo si el problema continúa.", { actionRequired: true });
  }
  if (session.hasSession) {
    return presentation("session", "active", "success", "Sesión activa", "La cuenta dispone de una sesión local válida.", { actionRequired: false });
  }
  const hasRememberedAccount = (accounts?.knownAccounts || []).length > 0;
  if (hasRememberedAccount) {
    return presentation("session", "remembered-without-session", "info", "Cuenta recordada sin sesión", "Selecciona la cuenta e inicia sesión para usar las funciones asociadas.", { actionRequired: true });
  }
  return presentation("session", "no-session", "neutral", "No has iniciado sesión", "Inicia sesión para competir y ver la actividad de tu cuenta.", { actionRequired: false });
}

export function deriveRememberedAccountPresentation(account = {}) {
  account = account || {};
  if (account.requiresLogin) {
    return presentation("account", "requires-login", "blocked", "Requiere iniciar sesión", account.requiresLoginMessage || "Esta cuenta necesita autenticarse de nuevo.");
  }
  if (account.hasLocalSession === true
    && account.shouldRetry !== false
    && account.terminal !== true
    && AUTO_RECOVERABLE_SESSION_STATUSES.has(account.status)) {
    return presentation("account", "available", "success", "Cuenta disponible", "La cuenta conserva una sesión local y no requiere ninguna acción.", {
      recoveryPending: true,
      technicalStatus: account.status,
    });
  }
  if (account.hasLocalSession === false || account.remoteUsable === false) {
    return presentation("account", "remembered-without-valid-session", "info", "Cuenta recordada", "La cuenta no se presenta como autenticada hasta tener una sesión válida.");
  }
  return presentation("account", "available", "success", "Cuenta disponible", "La cuenta dispone de una sesión local válida.");
}

export function deriveMembershipPresentation(membership = {}, session = {}, context = {}) {
  membership = membership || {};
  session = session || {};
  if (session.requiresLogin === true) {
    return presentation("membership", "requires-login", "blocked", "Vuelve a iniciar sesión", "Necesitas autenticar esta cuenta antes de competir.");
  }
  const status = membership.status || "unknown";
  const models = {
    checking: ["progress", "Comprobando participación", "Todavía no se ha confirmado tu participación en esta temporada."],
    member: ["success", "Participas en la temporada", "Tu cuenta puede competir en esta semana."],
    not_member: ["blocked", "No participas en la temporada", "Únete desde la web para poder competir en esta semana."],
    no_session: ["neutral", "Inicia sesión para competir", "La participación se comprueba por cuenta."],
    missing_week: ["blocked", "Falta la semana del pack", "El pack no está asociado a una semana y no puede competir."],
    invalid_week: ["blocked", "Semana del pack no válida", "High Score League no reconoce la semana configurada por este pack."],
    unknown: ["warning", "No se pudo consultar la participación", "No se pudo comprobar ahora. Si juegas, la puntuación quedará guardada localmente."],
    error: ["warning", "No se pudo consultar la participación", "La consulta falló temporalmente. Puedes volver a comprobarla."],
  };
  let normalizedStatus = status === "unauthenticated" ? "unknown" : status;
  const resolution = membership.resolution?.active === true ? membership.resolution : membership.request;
  const activeCurrentResolution = Boolean(resolution)
    && (resolution.active === true || resolution.inFlight === true)
    && resolution.contextCurrent === true
    && resolution.generation === membership.generation
    && resolution.accountId === context.accountId
    && resolution.instanceKey === context.instanceKey
    && resolution.weekId === context.weekId;
  if (status === "checking" && !activeCurrentResolution) normalizedStatus = "unknown";
  if (status === "unknown" && membership.authDeferred) normalizedStatus = "deferred";
  if (normalizedStatus === "deferred") {
    return presentation("membership", "deferred", "warning", "Comprobación aplazada", "La sesión local se conserva y la participación se comprobará cuando sea posible.");
  }
  const [severity, title, description] = models[normalizedStatus] || models.unknown;
  return presentation("membership", normalizedStatus, severity, title, description, {
    primaryAction: membership.joinUrl && normalizedStatus === "not_member"
      ? { action: "open-membership-url", label: "Ver temporada" }
      : null,
  });
}

const STABLE_MEMBERSHIP_PRESENTATION_STATUSES = new Set([
  "error",
  "invalid_week",
  "member",
  "missing_week",
  "no_session",
  "not_member",
  "requires-login",
  "unknown",
]);

function activeAccountId(state = {}) {
  return state.data?.accounts?.activeUserId || null;
}

function membershipContext(state = {}) {
  return {
    accountId: activeAccountId(state),
    instanceKey: state.data?.selection?.activeInstanceKey || state.data?.game?.instanceKey || null,
    weekId: state.data?.game?.weekId || state.data?.membership?.weekId || null,
  };
}

function sameMembershipContext(currentState, previousState) {
  const current = membershipContext(currentState);
  const previous = membershipContext(previousState);
  return Boolean(current.accountId && current.instanceKey && current.weekId)
    && current.accountId === previous.accountId
    && current.instanceKey === previous.instanceKey
    && current.weekId === previous.weekId;
}

function membershipPresentationIsPending(state = {}) {
  const membership = state.data?.membership || {};
  const derived = deriveMembershipPresentation(membership, state.data?.session, membershipContext(state));
  return derived.status === "checking"
    || derived.status === "deferred"
    || (membership.status === "unknown" && membership.technicalReason === "deferred" && !membership.checkedAt);
}

export function shouldPreserveMembershipPresentation(currentState = {}, previousState = null) {
  if (!previousState || !sameMembershipContext(currentState, previousState) || !membershipPresentationIsPending(currentState)) {
    return false;
  }
  const current = currentState.data?.membership || {};
  const currentPresentation = deriveMembershipPresentation(current, currentState.data?.session, membershipContext(currentState));
  if (currentPresentation.status === "checking") return false;
  const previous = previousState.data?.membership || {};
  const previousPresentation = deriveMembershipPresentation(previous, previousState.data?.session, membershipContext(previousState));
  const previousWasInitialDeferred = previous.status === "unknown"
    && previous.technicalReason === "deferred"
    && !previous.checkedAt;
  return STABLE_MEMBERSHIP_PRESENTATION_STATUSES.has(previousPresentation.status) && !previousWasInitialDeferred;
}

export function selectMembershipForPresentation(currentState = {}, previousState = null) {
  const current = currentState.data?.membership || {};
  if (!previousState || !sameMembershipContext(currentState, previousState)) return current;

  if (!membershipPresentationIsPending(currentState)) {
    return current;
  }
  const currentPresentation = deriveMembershipPresentation(current, currentState.data?.session, membershipContext(currentState));
  if (currentPresentation.status === "checking") return current;

  const previous = previousState.data?.membership || {};
  const previousPresentation = deriveMembershipPresentation(previous, previousState.data?.session, membershipContext(previousState));
  const previousWasInitialDeferred = previous.status === "unknown"
    && previous.technicalReason === "deferred"
    && !previous.checkedAt;
  return STABLE_MEMBERSHIP_PRESENTATION_STATUSES.has(previousPresentation.status) && !previousWasInitialDeferred
    ? previous
    : current;
}

export function deriveQueuePresentation(queue = {}, autoSync = {}, session = {}, connectivity = {}) {
  queue = queue || {};
  autoSync = autoSync || {};
  session = session || {};
  const totals = queue?.totals || { failed: 0, pending: 0, sent: 0 };
  const pending = Number(totals.pending) || 0;
  const failed = Number(totals.failed) || 0;
  const status = autoSync.status || "idle";
  const reason = autoSync.reason || null;
  const actionRequiredReasons = new Set(["attention_required", "failed_items"]);
  const loginRequiredReasons = new Set(["auth_required", "auth-required", "no_session", "requires_login", "unauthenticated"]);
  const structuralReasons = new Set(["invalid_week", "missing_scope", "missing_week", "not_member"]);
  const temporaryReasons = new Set([
    "cancelled",
    "cooldown",
    "error",
    "offline",
    "provider-unavailable",
    "rate-limited",
    "retryable",
    "retryable_http",
    "server",
    "session-deferred",
    "session-refresh-wait",
    "session_deferred",
    "submit_failed",
    "throttled",
    "timeout",
    "transport",
    "transport-failure",
    "unknown",
  ]);
  const connectionUnavailable = ["offline", "reconnecting"].includes(connectivity?.reachability)
    || ["offline", "reconnecting"].includes(connectivity?.displayStatus);

  if (!session.hasSession) {
    return presentation("queue", "locked", "neutral", "Inicia sesión", "Inicia sesión para ver la actividad local de esta cuenta.", { icon: "user" });
  }
  if (status === "syncing" || reason === "sync_in_progress") {
    return presentation("queue", "syncing", "progress", "Sincronizando", "Las puntuaciones siguen guardadas localmente mientras se envían.", { icon: "sync-pending" });
  }
  if (failed > 0 || status === "partial_failed") {
    return presentation("queue", "failed", "error", "Requiere atención", "Hay puntuaciones que no se enviaron. Siguen guardadas localmente y puedes restaurarlas a pendientes.", { icon: "sync-error" });
  }
  if (pending > 0 && (session.requiresLogin || loginRequiredReasons.has(reason))) {
    return presentation("queue", "failed", "error", "Requiere atención", `Hay ${pending} ${pending === 1 ? "puntuación guardada" : "puntuaciones guardadas"} localmente. Vuelve a iniciar sesión para poder enviarlas.`, { icon: "sync-error" });
  }
  if (pending > 0 && actionRequiredReasons.has(reason)) {
    return presentation("queue", "failed", "error", "Requiere atención", `Hay ${pending} ${pending === 1 ? "puntuación guardada" : "puntuaciones guardadas"} localmente. Revisa Diagnostics para resolver el envío.`, { icon: "sync-error" });
  }
  if (pending > 0 && structuralReasons.has(reason)) {
    return presentation("queue", "blocked", "blocked", "Envío bloqueado", `Hay ${pending} ${pending === 1 ? "puntuación guardada" : "puntuaciones guardadas"} localmente. El scope competitivo requiere atención antes de enviarlas.`, { icon: "sync-error" });
  }
  if (pending > 0 && (connectionUnavailable || temporaryReasons.has(reason))) {
    const deferredByConnection = connectionUnavailable || ["offline", "timeout", "transport", "transport-failure"].includes(reason);
    const title = deferredByConnection ? "Envío aplazado por conexión" : "Envío aplazado";
    return presentation("queue", "deferred", "warning", title, `Hay ${pending} ${pending === 1 ? "puntuación" : "puntuaciones"} guardadas localmente. Se enviarán cuando vuelva a ser posible.`, { icon: "sync-pending" });
  }
  if (pending > 0 && ["blocked", "failed"].includes(status)) {
    return presentation("queue", "blocked", "blocked", "Envío bloqueado", `Hay ${pending} ${pending === 1 ? "puntuación guardada" : "puntuaciones guardadas"} localmente. Revisa Diagnostics para resolver el bloqueo.`, { icon: "sync-error" });
  }
  if (pending > 0) {
    return presentation("queue", "pending", "info", "Pendiente de sincronizar", `Hay ${pending} ${pending === 1 ? "puntuación guardada" : "puntuaciones guardadas"} localmente. Cerrar la app no las elimina.`, { icon: "sync-pending" });
  }
  if (status === "synced") {
    const sentCount = Number(autoSync.sentCount) || 0;
    return presentation("queue", "synced", "success", "Sincronizado", sentCount > 0
      ? `${sentCount === 1 ? "Se ha enviado 1 puntuación" : `Se han enviado ${sentCount} puntuaciones`} correctamente.`
      : "Todo está al día, sin puntuaciones pendientes.", { icon: "sync-ok" });
  }
  return presentation("queue", "empty", "success", "Sin pendientes", "Todo está al día, sin puntuaciones pendientes.", { icon: "sync-ok" });
}

function hasStructuralWarning(readiness = {}) {
  const ignored = new Set(["membership", "auto-sync", "failed-queue", "session", "scope", "web-base-url"]);
  return (readiness.checks || []).some((item) => item.level === "warning" && !ignored.has(item.id));
}

export function derivePackPresentation({ game = null, readiness = {}, bridge = {} } = {}) {
  readiness = readiness || {};
  bridge = bridge || {};
  if (!game) {
    return presentation("pack", "missing", "blocked", "Sin pack seleccionado", "Selecciona un pack de la biblioteca para continuar.");
  }
  if (game.duplicateGroup || game.duplicatePackId || bridge.duplicateGroup) {
    return presentation("pack", "duplicate", "blocked", "Pack duplicado", "Hay varios packs con el mismo identificador. Conserva uno o corrige el identificador antes de jugar.");
  }
  if (readiness.canPractice === false) {
    const missingMame = (readiness.checks || []).some((item) => item.level === "error" && ["runtime-shared", "mame-executable", "mame-working-dir"].includes(item.id));
    return presentation("pack", missingMame ? "mame-unavailable" : "invalid", "blocked", missingMame ? "MAME no disponible" : "Pack no válido", missingMame
      ? "Configura un runtime MAME válido para poder practicar y competir."
      : "Corrige la configuración del pack antes de jugar.");
  }
  const legacy = bridge.contractStatus === "deprecated" || bridge.deprecated;
  if (legacy) {
    return presentation("pack", "legacy", "warning", "Pack legacy compatible", "Puedes usarlo, aunque conviene actualizarlo al contrato vigente.");
  }
  if (hasStructuralWarning(readiness)) {
    return presentation("pack", "warning", "warning", "Pack listo con avisos", "Puedes jugar; hay detalles no bloqueantes que conviene revisar.");
  }
  if (readiness.canPractice && readiness.canPlayCompetition === false) {
    return presentation("pack", "practice-only", "info", "Práctica disponible", "El pack permite practicar, pero la competición tiene otro bloqueo.");
  }
  return presentation("pack", "ready", "success", "Pack listo", "El pack está preparado para jugar.");
}

export function deriveLibraryPresentation(library = {}, selection = {}) {
  library = library || {};
  selection = selection || {};
  const status = library.status || "unconfigured";
  const directory = library.directory || {};
  if (status === "missing" || (directory.configured && directory.reason === "missing")) {
    return presentation("library", "missing", "error", "Biblioteca no encontrada", "Conecta de nuevo la unidad o elige otra ubicación.");
  }
  if (status === "inaccessible" || (directory.configured && !directory.available)) {
    return presentation("library", "inaccessible", "error", "Biblioteca inaccesible", "Comprueba la unidad o cambia la ubicación de la biblioteca.");
  }
  if (status === "unconfigured") {
    return presentation("library", "unconfigured", "info", "Configura tu biblioteca", "Elige una carpeta para empezar a añadir packs.");
  }
  if (status === "available-empty") {
    return presentation("library", "empty", "neutral", "Biblioteca vacía", "Importa un pack o elige otra carpeta.");
  }
  if (status === "available-populated" && !selection.activeInstanceKey) {
    return presentation("library", "no-selection", "info", "Selecciona un pack", "Elige un pack de la biblioteca para ver sus acciones.");
  }
  return presentation("library", "ready", "success", "Biblioteca disponible", "La biblioteca está preparada.");
}

export function deriveRankingPresentation(state = {}, game = {}) {
  const configuration = remoteConfigurationProblem(state.data?.remoteConfiguration);
  if (configuration) {
    return presentation("ranking", `configuration-${configuration.status}`, "blocked", "Ranking no disponible", configuration.description, { available: false });
  }
  if (!game?.weekId) {
    return presentation("ranking", "missing-week", "blocked", "Ranking sin semana", "Este pack no tiene una semana configurada para el ranking.", { available: false });
  }
  if (state.rankingOpening) {
    return presentation("ranking", "opening", "progress", "Abriendo ranking", "El ranking se está abriendo en el navegador.", { available: false });
  }
  const ranking = getRankingActionState(state, game);
  const capability = state.rankingCapabilities?.entries?.[game.weekId];
  if (ranking.available) {
    return presentation("ranking", "available", "success", "Ranking disponible", "Abre el ranking de esta semana.", { available: true, url: ranking.url });
  }
  if (deriveRemoteAvailability(state.connectivity).status === "offline") {
    return presentation("ranking", "offline", "warning", "Ranking sin conexión", "Recupera la conexión con High Score League para abrirlo.", { available: false });
  }
  if (capability?.status === "unavailable") {
    return presentation("ranking", "not-published", "info", "Ranking no publicado", "El ranking de esta semana todavía no está disponible.", { available: false });
  }
  if (capability?.status === "unknown") {
    return presentation("ranking", "error", "warning", "Ranking sin confirmar", "No se pudo comprobar ahora. Vuelve a intentarlo cuando haya conexión.", { available: false });
  }
  return presentation("ranking", "checking", "progress", "Comprobando ranking", "Todavía se está comprobando la disponibilidad del ranking.", { available: false });
}

function actionPresentation(action, label, icon, available, reason = null, extra = {}) {
  return {
    action,
    label,
    icon,
    available: available === true,
    reason: available ? null : reason,
    reasonId: `action-block-${action}`,
    ...extra,
  };
}

function firstReadinessBlocker(readiness, fallback) {
  const message = (readiness?.blockers || []).find((item) => typeof item === "string" && item.trim());
  return message || fallback;
}

export function derivePrimaryActions(state = {}) {
  const data = state.data || {};
  const game = data.game || null;
  const readiness = data.readiness || {};
  const session = data.session || {};
  const membership = deriveMembershipPresentation(data.membership, session, membershipContext(state));
  const pack = derivePackPresentation({ game, readiness, bridge: data.bridge });
  const ranking = deriveRankingPresentation(state, game || {});
  const access = data.competitionAccess || readiness.competitionAccess || null;
  const busyReason = state.busy ? state.busyLabel || "Hay otra operación en curso." : null;

  let competitionReason = null;
  if (busyReason) competitionReason = busyReason;
  else if (!game) competitionReason = "Selecciona un pack para competir.";
  else if (["duplicate", "invalid", "mame-unavailable"].includes(pack.status)) competitionReason = pack.description;
  else if (access?.canPlayCompetition === false) {
    const reasons = {
      "requires-login": "Vuelve a iniciar sesión con esta cuenta para competir.",
      "no-account": "Inicia sesión para competir.",
      "not-member": membership.description,
      "membership-unknown": membership.status === "checking" ? membership.title : "Todaví­a no se ha confirmado la participación de esta cuenta.",
      "week-inactive": "La semana todaví­a no está activa.",
      "week-closed": "La semana está cerrada.",
      "week-unlinked": "El pack no está vinculado a una semana competitiva.",
      "week-unknown": "Todaví­a no se ha confirmado el estado de la semana.",
      "local-pack-unavailable": firstReadinessBlocker(readiness, "Este pack no puede ejecutarse localmente."),
      "local-capture-unavailable": firstReadinessBlocker(readiness, "La captura competitiva local no está preparada."),
    };
    competitionReason = reasons[access.reason] || "La competición no está disponible.";
  }
  else if (session.requiresLogin) competitionReason = "Vuelve a iniciar sesión con esta cuenta para competir.";
  else if (!session.hasSession) competitionReason = "Inicia sesión para competir.";
  else if (membership.status === "checking") competitionReason = membership.title;
  else if (data.membership?.canPlayCompetition === false) competitionReason = membership.description;
  else if (readiness.canPlayCompetition === false) competitionReason = firstReadinessBlocker(readiness, "Este pack todavía no está preparado para competir.");

  let practiceReason = null;
  if (busyReason) practiceReason = busyReason;
  else if (!game) practiceReason = "Selecciona un pack para practicar.";
  else if (readiness.canPractice === false) practiceReason = firstReadinessBlocker(readiness, pack.description);

  let manualReason = null;
  if (busyReason) manualReason = busyReason;
  else if (!game) manualReason = "Selecciona un pack para consultar su manual.";
  else if (!game.manual?.available) manualReason = "Este pack no incluye un manual local.";

  const rankingReason = busyReason || (ranking.available ? null : ranking.description);

  return {
    competition: actionPresentation("play", "Jugar", "play", !competitionReason, competitionReason),
    practice: actionPresentation("practice", "Práctica", "practice", !practiceReason, practiceReason),
    manual: actionPresentation("open-manual", "Manual", "manual", !manualReason, manualReason),
    ranking: actionPresentation("open-ranking", "Ranking", "ranking", !rankingReason, rankingReason),
  };
}

export function deriveSupportingActions(state = {}) {
  const data = state.data || {};
  const session = data.session || {};
  const remote = deriveRemoteAvailability(state.connectivity);
  const connectivity = deriveConnectivityPresentation(state.connectivity, data.remoteConfiguration);
  const publicConnectivity = derivePublicConnectivityPresentation(state.connectivity, data.remoteConfiguration);
  const busyReason = state.busy ? state.busyLabel || "Hay otra operación en curso." : null;
  const manualProbe = state.connectivity?.probe?.phase === "manual" && state.connectivity?.probe?.inFlight;
  const refreshReason = busyReason
    || (connectivity.domain === "remote-configuration" ? connectivity.description : null)
    || (state.connectivity?.activity === "suspended" ? "La comprobación se reanudará al volver a la aplicación." : null)
    || (!publicConnectivity.committed ? "Espera al primer resultado de conexión." : null)
    || (manualProbe ? "Ya se está comprobando la conexión." : null);
  const loginReason = busyReason || (connectivity.domain === "remote-configuration" || !remote.available ? connectivity.description : null);
  const directoryAvailable = data.library?.directory?.available === true;
  return {
    login: actionPresentation("login", "Entrar", "user", !loginReason, loginReason),
    switchAccount: actionPresentation("switch-account", "Cambiar cuenta", "user", !busyReason, busyReason),
    restoreFailed: actionPresentation("restore-failed", "Restaurar a pendientes", "refresh", !busyReason, busyReason),
    refreshConnectivity: actionPresentation("refresh-connectivity", "Comprobar conexión", "refresh", !refreshReason, refreshReason),
    checkMembership: actionPresentation("check-membership", "Comprobar de nuevo", "refresh", !busyReason && session.hasSession && remote.available && connectivity.domain !== "remote-configuration", busyReason || (!session.hasSession ? "Inicia sesión para comprobar tu participación." : connectivity.domain === "remote-configuration" ? connectivity.description : !remote.available ? "Recupera la conexión para comprobar tu participación." : null)),
    chooseLibrary: actionPresentation("choose-pack-directory", "Cambiar biblioteca", "folder", !busyReason, busyReason),
    rescanLibrary: actionPresentation("rescan-pack-directory", "Reescanear", "refresh", !busyReason && directoryAvailable, busyReason || (!directoryAvailable ? "Configura una biblioteca accesible antes de reescanear." : null)),
    importPack: actionPresentation("import-pack", "Importar pack", "add", !busyReason, busyReason),
    openLibraryFolder: actionPresentation("open-pack-directory", "Abrir carpeta", "folder", !busyReason && directoryAvailable, busyReason || (!directoryAvailable ? "La carpeta de la biblioteca no está disponible." : null)),
  };
}

export function deriveGameSummaryPresentation(state = {}) {
  const data = state.data || {};
  const pack = derivePackPresentation({ game: data.game, readiness: data.readiness, bridge: data.bridge });
  if (["duplicate", "invalid", "mame-unavailable", "legacy", "warning"].includes(pack.status)) return pack;
  const membership = deriveMembershipPresentation(data.membership, data.session, membershipContext(state));
  if (["not_member", "no_session", "missing_week", "invalid_week", "requires-login", "error", "unknown", "deferred", "checking"].includes(membership.status)) return membership;
  if (pack.status === "ready" && membership.status === "member") {
    return presentation("game", "competition-ready", "success", "Pack listo", "El pack y tu participación están preparados.");
  }
  return pack;
}

export function deriveLauncherPresentation(state = {}) {
  const data = state.data || {};
  return {
    actions: derivePrimaryActions(state),
    supportingActions: deriveSupportingActions(state),
    connectivity: derivePublicConnectivityPresentation(state.connectivity, data.remoteConfiguration),
    game: deriveGameSummaryPresentation(state),
    library: deriveLibraryPresentation(data.library, data.selection),
    membership: deriveMembershipPresentation(data.membership, data.session, membershipContext(state)),
    pack: derivePackPresentation({ game: data.game, readiness: data.readiness, bridge: data.bridge }),
    queue: deriveQueuePresentation(data.queue, data.autoSync, data.session, state.connectivity),
    ranking: deriveRankingPresentation(state, data.game || {}),
    session: deriveSessionPresentation(data.session, data.accounts, state),
  };
}

export function deriveLiveAnnouncement(previousState, nextState, changedKeys = []) {
  if (!previousState) return null;
  if (changedKeys.includes("logs")) {
    const latest = nextState.logs?.[0];
    if (latest && latest !== previousState.logs?.[0]) return latest.summary || latest.title || null;
  }
  if (changedKeys.includes("initialLoadError") && nextState.initialLoadError) return nextState.initialLoadError;
  if (changedKeys.includes("connectivity")) {
    const current = derivePublicConnectivityPresentation(nextState.connectivity, nextState.data?.remoteConfiguration);
    const previous = derivePublicConnectivityPresentation(previousState.connectivity, previousState.data?.remoteConfiguration);
    const manualFeedbackVisible = nextState.busy === true && nextState.busyLabel === "Comprobando conexión";
    if (!manualFeedbackVisible && current.committed && (!previous.committed || current.status !== previous.status)) return current.title;
  }
  if (changedKeys.includes("data")) {
    const current = deriveQueuePresentation(nextState.data?.queue, nextState.data?.autoSync, nextState.data?.session, nextState.connectivity);
    const previous = deriveQueuePresentation(previousState.data?.queue, previousState.data?.autoSync, previousState.data?.session, previousState.connectivity);
    if (current.status !== previous.status && ["failed", "synced"].includes(current.status)) return `${current.title}. ${current.description}`;
  }
  return null;
}

export function shouldSurfaceAccountSwitchResult(response) {
  if (!response || typeof response !== "object") return true;
  return response.ok === false
    || response.requiresLogin === true
    || response.action !== "switch-account";
}
