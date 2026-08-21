const crypto = require("node:crypto");
const fs = require("node:fs");
const { adoptNewStagingEvents } = require("./staging-event-adoption");

function diagnosticId(prefix, value) {
  if (!value) return null;
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : error?.name || "Error";
}

function createScoreCaptureConvergence(options = {}) {
  const context = Object.freeze({
    packKey: options.packKey,
    playerKey: options.playerKey,
    runId: options.runId,
    competitionGuard: options.competitionGuard || null,
    scopedRejectedDir: options.scopedRejectedDir || null,
    scopedPendingDir: options.scopedPendingDir,
    stagingPendingDir: options.stagingPendingDir,
  });
  if (!context.runId || !context.stagingPendingDir || !context.scopedPendingDir || !context.playerKey || !context.packKey) {
    throw new Error("El monitor de capturas requiere un contexto v2 completo y congelado.");
  }
  if (context.competitionGuard && !context.scopedRejectedDir) throw new Error("El monitor protegido requiere una caja rejected scoped.");

  const adoptImpl = options.adoptImpl || adoptNewStagingEvents;
  const watchImpl = options.watchImpl || fs.watch;
  const now = options.now || (() => new Date().toISOString());
  const allAdopted = [];
  const allRejected = [];
  let acceptingSignals = false;
  let closePromise = null;
  let scanPromise = null;
  let rescanRequested = false;
  let watcher = null;
  let diagnostics = {
    activeRun: diagnosticId("run", context.runId),
    closeAdopted: 0,
    closed: false,
    lastAdoptedAt: null,
    lastRun: null,
    lastScanErrorCode: null,
    lastSubmitTrigger: null,
    lastWatchErrorCode: null,
    liveAdopted: 0,
    localRejected: 0,
    rescanQueued: false,
    scanErrors: 0,
    scanInFlight: false,
    scanRuns: 0,
    scope: diagnosticId("scope", `${context.playerKey}:${context.packKey}`),
    submitRequests: 0,
    watchErrors: 0,
    watching: false,
    watchSignals: 0,
  };

  function publishDiagnostics(patch = {}) {
    diagnostics = { ...diagnostics, ...patch };
    try { options.onDiagnostics?.({ ...diagnostics }); } catch {}
  }

  function recordWatchError(error) {
    publishDiagnostics({
      lastWatchErrorCode: errorCode(error),
      watchErrors: diagnostics.watchErrors + 1,
    });
  }

  function handleWatchError(error) {
    recordWatchError(error);
    if (watcher) {
      try { watcher.close(); } catch {}
      watcher = null;
    }
    publishDiagnostics({ watching: false });
  }

  function requestSubmit(adopted, phase) {
    if (adopted.length === 0) return;
    const trigger = "score-adopted";
    allAdopted.push(...adopted);
    publishDiagnostics({
      closeAdopted: diagnostics.closeAdopted + (phase === "close" ? adopted.length : 0),
      lastAdoptedAt: now(),
      lastSubmitTrigger: trigger,
      liveAdopted: diagnostics.liveAdopted + (phase === "live" ? adopted.length : 0),
      submitRequests: diagnostics.submitRequests + 1,
    });
    try {
      Promise.resolve(options.onAdopted?.({ adopted: [...adopted], phase, trigger })).catch(() => {});
    } catch {}
  }

  async function scanOnce(phase) {
    publishDiagnostics({
      scanInFlight: true,
      scanRuns: diagnostics.scanRuns + 1,
    });
    try {
      const adoption = await adoptImpl(
        context.stagingPendingDir,
        context.scopedPendingDir,
        new Map(),
        0,
        {
          competitionGuard: context.competitionGuard,
          scopedRejectedDir: context.scopedRejectedDir,
        },
      );
      const adopted = Array.isArray(adoption?.adopted) ? adoption.adopted : [];
      const rejected = Array.isArray(adoption?.rejected) ? adoption.rejected : [];
      allRejected.push(...rejected);
      if (rejected.length > 0) publishDiagnostics({ localRejected: diagnostics.localRejected + rejected.length });
      requestSubmit(adopted, phase);
      return adoption || { adopted: [], skippedLegacy: [] };
    } catch (error) {
      publishDiagnostics({
        lastScanErrorCode: errorCode(error),
        scanErrors: diagnostics.scanErrors + 1,
      });
      throw error;
    } finally {
      publishDiagnostics({ scanInFlight: false });
    }
  }

  function requestRescan() {
    if (!acceptingSignals) return scanPromise || Promise.resolve({ adopted: [], skippedLegacy: [] });
    if (scanPromise) {
      rescanRequested = true;
      publishDiagnostics({ rescanQueued: true });
      return scanPromise;
    }

    scanPromise = (async () => {
      let result = { adopted: [], skippedLegacy: [] };
      do {
        rescanRequested = false;
        publishDiagnostics({ rescanQueued: false });
        result = await scanOnce("live");
      } while (acceptingSignals && rescanRequested);
      return result;
    })().finally(() => {
      scanPromise = null;
      publishDiagnostics({ rescanQueued: false });
    });
    return scanPromise;
  }

  function handleWatchSignal() {
    if (!acceptingSignals) return;
    publishDiagnostics({ watchSignals: diagnostics.watchSignals + 1 });
    requestRescan().catch(() => {});
  }

  function start() {
    if (acceptingSignals || diagnostics.closed) return;
    acceptingSignals = true;
    try {
      watcher = watchImpl(context.stagingPendingDir, { persistent: false }, handleWatchSignal);
      watcher?.on?.("error", handleWatchError);
      publishDiagnostics({ watching: Boolean(watcher) });
    } catch (error) {
      watcher = null;
      recordWatchError(error);
      publishDiagnostics({ watching: false });
    }
  }

  function close(closeOptions = {}) {
    if (closePromise) return closePromise;
    const finalRescan = closeOptions.finalRescan !== false;
    acceptingSignals = false;
    if (watcher) {
      try {
        watcher.close();
      } catch (error) {
        recordWatchError(error);
      }
      watcher = null;
    }
    publishDiagnostics({ watching: false });

    const closingRun = diagnostics.activeRun;
    closePromise = (async () => {
      try {
        if (scanPromise) await scanPromise.catch(() => {});
        if (finalRescan) await scanOnce("close");
        return {
          adopted: [...allAdopted],
          diagnostics: null,
          rejected: [...allRejected],
          skippedLegacy: [],
        };
      } finally {
        publishDiagnostics({
          activeRun: null,
          closed: true,
          lastRun: closingRun,
          rescanQueued: false,
          scanInFlight: false,
        });
      }
    })().then((result) => ({ ...result, diagnostics: { ...diagnostics } }));
    return closePromise;
  }

  return {
    close,
    getDiagnostics: () => ({ ...diagnostics }),
    requestRescan,
    start,
  };
}

module.exports = {
  createScoreCaptureConvergence,
  diagnosticId,
};
