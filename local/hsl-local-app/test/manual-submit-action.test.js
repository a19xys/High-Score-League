const test = require("node:test");
const assert = require("node:assert/strict");

function state(patch = {}) {
  return {
    busy: false,
    connectivity: { reachability: "connected" },
    data: {
      autoSync: { status: "idle" }, membership: { canSubmit: true },
      queue: { pending: { count: 1, validCount: 1 }, totals: { pending: 1 } },
      readiness: { canSubmit: true }, scope: { packKey: "pack-one" }, session: { hasSession: true },
    },
    ...patch,
  };
}

test("manual submit selector covers connectivity, session, queue, and lock", async () => {
  const { deriveManualSubmitAction } = await import("../gui/renderer/manual-submit-action.js");
  assert.equal(deriveManualSubmitAction(state()).enabled, true);
  assert.match(deriveManualSubmitAction(state({ connectivity: { reachability: "offline" } })).reason, /conexion/);
  assert.match(deriveManualSubmitAction(state({ data: { ...state().data, session: { hasSession: false } } })).reason, /sesion/);
  assert.match(deriveManualSubmitAction(state({ data: { ...state().data, queue: { pending: { count: 0, validCount: 0 }, totals: { pending: 0 } } } })).reason, /No hay/);
  assert.match(deriveManualSubmitAction(state({ busy: true })).reason, /subiendo/);
});
