const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 15000;

function safeTechnicalReason(error) {
  const name = typeof error?.name === "string" ? error.name : "Error";
  const code = typeof error?.code === "string" ? error.code : null;
  return code ? `${name}:${code}` : name;
}

function safeCancellationReason(reason) {
  const allowed = new Set([
    "account-change",
    "external-abort",
    "logout",
    "remove-account",
    "shutdown",
    "suspend",
    "switch-account",
  ]);
  return allowed.has(reason) ? reason : "external-abort";
}

function combineAbortSignals(signals = []) {
  const controller = new AbortController();
  const listeners = [];
  const abortFrom = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal?.reason || "external-abort");
  };

  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push([signal, listener]);
  }

  return {
    signal: controller.signal,
    dispose() {
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    },
  };
}

async function executeRemoteRequest(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_REMOTE_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = options.signal || null;
  if (externalSignal?.aborted) {
    return {
      failureType: "cancelled",
      ok: false,
      reason: safeCancellationReason(externalSignal.reason),
      technicalReason: "AbortError",
    };
  }
  let failureType = null;
  let cancellationReason = null;
  let timer = null;
  let externalListener = null;
  let rejectCancellation;
  const cancellation = new Promise((_, reject) => {
    rejectCancellation = reject;
  });

  const cancel = (type, reason) => {
    if (failureType) return;
    failureType = type;
    cancellationReason = type === "timeout" ? "deadline-exceeded" : safeCancellationReason(reason);
    controller.abort(reason);
    const error = new Error(type);
    error.name = type === "timeout" ? "TimeoutError" : "AbortError";
    rejectCancellation(error);
  };

  if (externalSignal) {
    externalListener = () => cancel("cancelled", externalSignal.reason || "external-abort");
    externalSignal.addEventListener("abort", externalListener, { once: true });
  }

  timer = setTimeout(() => cancel("timeout", "remote-request-timeout"), timeoutMs);
  timer.unref?.();

  const operation = (async () => {
    const response = await fetchImpl(options.url, {
      ...(options.init || {}),
      redirect: "error",
      signal: controller.signal,
    });
    const bodyText = await response.text();
    return { bodyText, response };
  })();

  try {
    const { bodyText, response } = await Promise.race([operation, cancellation]);
    return {
      bodyText,
      httpStatus: response.status,
      ok: true,
      response,
    };
  } catch (error) {
    const type = failureType || (controller.signal.aborted ? "cancelled" : "transport-failure");
    return {
      failureType: type,
      ok: false,
      reason: type === "timeout" ? "deadline-exceeded" : type === "cancelled" ? cancellationReason : "request-failed",
      technicalReason: safeTechnicalReason(error),
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (externalSignal && externalListener) externalSignal.removeEventListener("abort", externalListener);
  }
}

module.exports = {
  DEFAULT_REMOTE_REQUEST_TIMEOUT_MS,
  combineAbortSignals,
  executeRemoteRequest,
  safeCancellationReason,
  safeTechnicalReason,
};
