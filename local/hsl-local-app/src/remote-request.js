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
      redirect: options.redirect || "error",
      signal: controller.signal,
    });
    if (options.responseType === "arrayBuffer") {
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(options.maxResponseBytes) && declaredLength > options.maxResponseBytes) {
        throw Object.assign(new Error("response-too-large"), { code: "RESPONSE_TOO_LARGE" });
      }
      let bodyBuffer;
      if (response.body?.getReader && Number.isFinite(options.maxResponseBytes)) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          total += chunk.byteLength;
          if (total > options.maxResponseBytes) {
            await reader.cancel("response-too-large").catch(() => {});
            throw Object.assign(new Error("response-too-large"), { code: "RESPONSE_TOO_LARGE" });
          }
          chunks.push(chunk);
        }
        bodyBuffer = Buffer.concat(chunks, total);
      } else {
        bodyBuffer = Buffer.from(await response.arrayBuffer());
      }
      if (Number.isFinite(options.maxResponseBytes) && bodyBuffer.byteLength > options.maxResponseBytes) {
        throw Object.assign(new Error("response-too-large"), { code: "RESPONSE_TOO_LARGE" });
      }
      return { bodyBuffer, response };
    }
    const bodyText = await response.text();
    return { bodyText, response };
  })();

  try {
    const { bodyBuffer, bodyText, response } = await Promise.race([operation, cancellation]);
    return {
      bodyBuffer,
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
