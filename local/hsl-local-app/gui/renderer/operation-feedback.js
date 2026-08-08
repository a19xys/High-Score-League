export const DEFAULT_OPERATION_MIN_VISIBLE_MS = 600;

let feedbackRunSequence = 0;
let activeFeedbackController = null;

export function minimumVisibleMsForScope(scope = "transient") {
  return scope === "inline" ? 0 : DEFAULT_OPERATION_MIN_VISIBLE_MS;
}

export function remainingMinimumVisibleMs(startedAt, minVisibleMs, now = Date.now()) {
  const started = Number(startedAt);
  const minimum = Math.max(0, Number(minVisibleMs) || 0);
  const current = Number(now);

  if (!Number.isFinite(started) || !Number.isFinite(current)) {
    return 0;
  }

  return Math.max(0, minimum - Math.max(0, current - started));
}

export async function waitForMinimumVisibleDuration({
  minVisibleMs = DEFAULT_OPERATION_MIN_VISIBLE_MS,
  now = Date.now,
  signal,
  startedAt,
  wait = (duration, { signal: waitSignal } = {}) => new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (timer !== null) globalThis.clearTimeout(timer);
      waitSignal?.removeEventListener?.("abort", finish);
      timer = null;
      resolve();
    };
    timer = globalThis.setTimeout(finish, duration);
    if (waitSignal?.aborted) finish();
    else waitSignal?.addEventListener?.("abort", finish, { once: true });
  }),
} = {}) {
  const remaining = remainingMinimumVisibleMs(startedAt, minVisibleMs, now());

  if (remaining > 0) {
    await wait(remaining, { signal });
  }

  return remaining;
}

export function cancelActiveOperationFeedback() {
  activeFeedbackController?.abort();
  activeFeedbackController = null;
}

export async function runWithOperationFeedback({
  isCurrent = () => true,
  now = Date.now,
  onFinish,
  onStart,
  operation,
  scope = "transient",
  startedAt: providedStartedAt,
  wait,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  activeFeedbackController?.abort();
  const feedbackController = new AbortController();
  activeFeedbackController = feedbackController;
  const runId = ++feedbackRunSequence;
  const startContext = { runId, scope, startedAt: null };
  let result;
  let error;

  try {
    await onStart?.(startContext);
    const startedAt = Number.isFinite(providedStartedAt) ? providedStartedAt : now();
    const context = { ...startContext, startedAt };
    try {
      result = await operation(context);
    } catch (operationError) {
      error = operationError;
    }

    if (feedbackController.signal.aborted || !isCurrent(runId)) {
      if (error) throw error;
      return result;
    }

    await waitForMinimumVisibleDuration({
      minVisibleMs: minimumVisibleMsForScope(scope),
      now,
      signal: feedbackController.signal,
      startedAt,
      ...(wait ? { wait } : {}),
    });

    if (!feedbackController.signal.aborted && isCurrent(runId)) {
      await onFinish?.({ ...context, error, result, status: error ? "error" : "success" });
    }
    if (error) throw error;
    return result;
  } finally {
    if (activeFeedbackController === feedbackController) activeFeedbackController = null;
  }
}
