function createExitCoordinator(options = {}) {
  let phase = "idle";
  let intent = "normal";
  let drainPromise = null;
  let finalQuitRequested = false;

  function getState() {
    return { finalQuitRequested, intent, phase };
  }

  function setIntent(nextIntent) {
    if (phase !== "idle") return false;
    intent = nextIntent === "update" ? "update" : "normal";
    return true;
  }

  function clearIntent(expectedIntent = null) {
    if (phase !== "idle") return false;
    if (expectedIntent && intent !== expectedIntent) return false;
    intent = "normal";
    return true;
  }

  function requestExit(reason = intent) {
    if (phase === "armed") return drainPromise || Promise.resolve(getState());
    if (drainPromise) return drainPromise;

    intent = reason === "update" ? "update" : "normal";
    phase = "draining";
    options.onExitStarted?.(intent);
    drainPromise = Promise.resolve()
      .then(() => options.drain?.(intent))
      .catch((error) => {
        options.onDrainError?.(error, intent);
      })
      .then(() => {
        phase = "armed";
        if (!finalQuitRequested) {
          finalQuitRequested = true;
          options.finalQuit?.(intent);
        }
        return getState();
      });
    return drainPromise;
  }

  function handleBeforeQuit(event) {
    if (phase === "armed") return false;
    event?.preventDefault?.();
    requestExit(intent);
    return true;
  }

  return {
    clearIntent,
    getState,
    handleBeforeQuit,
    requestExit,
    setIntent,
  };
}

module.exports = { createExitCoordinator };
