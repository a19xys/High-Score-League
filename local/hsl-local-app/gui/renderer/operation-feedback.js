export const DEFAULT_OPERATION_MIN_VISIBLE_MS = 600;

let feedbackRunSequence = 0;

export function minimumVisibleMsForScope(scope = "transient", minVisibleMs) {
  if (Number.isFinite(minVisibleMs)) return Math.max(0, minVisibleMs);
  return scope === "transient" ? DEFAULT_OPERATION_MIN_VISIBLE_MS : 0;
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
  startedAt,
  wait = (duration) => new Promise((resolve) => globalThis.setTimeout(resolve, duration)),
} = {}) {
  const remaining = remainingMinimumVisibleMs(startedAt, minVisibleMs, now());

  if (remaining > 0) {
    await wait(remaining);
  }

  return remaining;
}

export async function runWithOperationFeedback({
  isCurrent = () => true,
  minVisibleMs,
  now = Date.now,
  onFinish,
  onStart,
  operation,
  scope = "transient",
  startedAt: providedStartedAt,
  wait,
} = {}) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  const runId = ++feedbackRunSequence;
  const startedAt = Number.isFinite(providedStartedAt) ? providedStartedAt : now();
  const context = { runId, scope, startedAt };
  let result;
  let error;

  await onStart?.(context);
  try {
    result = await operation(context);
  } catch (operationError) {
    error = operationError;
  }

  await waitForMinimumVisibleDuration({
    minVisibleMs: minimumVisibleMsForScope(scope, minVisibleMs),
    now,
    startedAt,
    ...(wait ? { wait } : {}),
  });

  if (isCurrent(runId)) {
    await onFinish?.({ ...context, error, result, status: error ? "error" : "success" });
  }
  if (error) throw error;
  return result;
}
