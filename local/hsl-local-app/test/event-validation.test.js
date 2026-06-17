const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEvent } = require("../src/event-validation");

function validEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    game: "Space Invaders",
    rom: "invaders",
    score: 1230,
    detectedAt: "2026-05-24T22:08:00Z",
    source: "mame_memory",
    mameVersion: "MAME 0.265",
    pluginVersion: "0.1.4",
    detection: {
      method: "memory_bcd_p1_score_descriptor_with_rollover_tracker",
      manualConfirm: true,
      gameOverDetected: false,
    },
    scoreData: {
      displayScore: 1230,
      trackedScore: 1230,
      rollovers: 0,
    },
    ...overrides,
  };
}

test("validateEvent accepts a complete v1 MAME event", () => {
  const result = validateEvent(validEvent());

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("validateEvent rejects missing required fields", () => {
  const result = validateEvent({
    schemaVersion: 2,
    score: -1,
    detectedAt: "not-a-date",
    source: "unknown",
  });

  const errors = result.errors.join("\n");

  assert.match(errors, /schemaVersion debe ser 1/);
  assert.match(errors, /rom debe ser un string/);
  assert.match(errors, /score debe ser un entero >= 0/);
  assert.match(errors, /detectedAt no es una fecha válida/);
  assert.match(errors, /source no permitido: unknown/);
});

test("validateEvent warns but does not reject optional audit metadata", () => {
  const event = validEvent({
    game: undefined,
    pluginVersion: undefined,
    mameVersion: undefined,
    detection: undefined,
    scoreData: undefined,
  });

  const result = validateEvent(event);

  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.includes("game falta o no es string"));
  assert.ok(result.warnings.includes("pluginVersion falta o no es string"));
  assert.ok(result.warnings.includes("mameVersion falta o no es string"));
  assert.ok(result.warnings.includes("detection falta o no es objeto"));
  assert.ok(result.warnings.includes("scoreData falta o no es objeto"));
});
