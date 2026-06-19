const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAutoSyncBlockReason,
  getAutoSyncDisplayState,
  shouldAutoSync,
  summarizeAutoSyncAttempt,
} = require("../src/auto-sync");

function context(overrides = {}) {
  return {
    autoSyncInProgress: false,
    membership: {
      canSubmit: true,
      status: "member",
    },
    queue: {
      totals: {
        failed: 0,
        pending: 1,
        sent: 0,
      },
    },
    scope: {
      scopedQueueRoot: "C:/userData/players/u/packs/p",
    },
    session: {
      hasSession: true,
    },
    ...overrides,
  };
}

function queue(totals) {
  return {
    totals: {
      failed: totals.failed || 0,
      pending: totals.pending || 0,
      sent: totals.sent || 0,
    },
  };
}

test("shouldAutoSync true solo con sesion, member, scope y pending", () => {
  assert.equal(shouldAutoSync(context()), true);
});

test("shouldAutoSync rechaza estados de membership no seguros", () => {
  for (const status of ["not_member", "unknown", "error", "unauthenticated", "missing_week", "invalid_week", "no_session"]) {
    assert.equal(shouldAutoSync(context({
      membership: {
        canSubmit: false,
        status,
      },
    })), false);
  }
});

test("shouldAutoSync rechaza sin pending, sin scope o con lock", () => {
  assert.equal(shouldAutoSync(context({ queue: queue({ pending: 0 }) })), false);
  assert.equal(shouldAutoSync(context({ scope: null })), false);
  assert.equal(shouldAutoSync(context({ autoSyncInProgress: true })), false);
});

test("getAutoSyncBlockReason devuelve mensajes de jugador", () => {
  assert.match(getAutoSyncBlockReason(context({
    membership: {
      canSubmit: false,
      status: "not_member",
    },
  })).message, /no participas/i);

  assert.match(getAutoSyncBlockReason(context({
    session: {
      hasSession: false,
    },
  })).message, /inicia sesion/i);
});

test("summarizeAutoSyncAttempt marca synced cuando no queda pending", () => {
  const result = summarizeAutoSyncAttempt({
    afterQueue: queue({ pending: 0, sent: 2 }),
    beforeQueue: queue({ pending: 2, sent: 0 }),
    now: "2026-06-20T00:00:00.000Z",
    ok: true,
  });

  assert.equal(result.status, "synced");
  assert.equal(result.pendingBefore, 2);
  assert.equal(result.pendingAfter, 0);
  assert.equal(result.sentCount, 2);
  assert.equal(result.lastSuccessAt, "2026-06-20T00:00:00.000Z");
});

test("summarizeAutoSyncAttempt marca partial_failed si aparecen failed", () => {
  const result = summarizeAutoSyncAttempt({
    afterQueue: queue({ failed: 1, pending: 0, sent: 1 }),
    beforeQueue: queue({ failed: 0, pending: 2, sent: 0 }),
    now: "2026-06-20T00:00:00.000Z",
    ok: false,
  });

  assert.equal(result.status, "partial_failed");
  assert.equal(result.failedCount, 1);
  assert.match(result.message, /requieren atencion/i);
});

test("display state bloquea unknown/error aunque competicion pueda jugarse", () => {
  const result = getAutoSyncDisplayState(context({
    membership: {
      canSubmit: false,
      status: "unknown",
    },
  }));

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "unknown");
  assert.match(result.message, /no se pudo comprobar/i);
});
