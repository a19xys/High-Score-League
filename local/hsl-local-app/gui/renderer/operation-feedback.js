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
  minVisibleMs = 0,
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
