const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDuplicateKey,
  buildSubmissionPayload,
  responseLooksDuplicate,
  responseLooksOk,
} = require("../src/submission-payload");

const config = {
  defaultWeekId: "week-123",
  clientVersion: "0.1.0",
  defaultComment: "Subida desde app local",
};

const storedSession = {
  user: {
    id: "user-456",
  },
};

const event = {
  schemaVersion: 1,
  game: "Space Invaders",
  rom: "invaders",
  score: 4320,
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
    displayScore: 4320,
    trackedScore: 4320,
    rollovers: 0,
  },
};

test("buildDuplicateKey is stable for the same event and user", () => {
  const first = buildDuplicateKey(config, event, storedSession);
  const second = buildDuplicateKey(config, event, storedSession);

  assert.equal(first, second);
  assert.match(first, /^hsl:v1:[a-f0-9]{64}$/);
});

test("buildDuplicateKey changes when stable identity inputs change", () => {
  const first = buildDuplicateKey(config, event, storedSession);
  const second = buildDuplicateKey(
    config,
    { ...event, score: event.score + 10 },
    storedSession
  );

  assert.notEqual(first, second);
});

test("buildSubmissionPayload preserves normalized fields and raw local event", () => {
  const payload = buildSubmissionPayload(config, event, storedSession);

  assert.equal(payload.weekId, config.defaultWeekId);
  assert.equal(payload.score, event.score);
  assert.equal(payload.detectedAt, event.detectedAt);
  assert.equal(payload.source, event.source);
  assert.equal(payload.rom, event.rom);
  assert.equal(payload.mameVersion, event.mameVersion);
  assert.equal(payload.clientVersion, config.clientVersion);
  assert.equal(payload.comment, config.defaultComment);
  assert.equal(payload.rawEvent.localEvent, event);
  assert.equal(payload.rawEvent.detection, event.detection);
  assert.equal(payload.rawEvent.scoreData, event.scoreData);
  assert.equal(payload.duplicateKey, buildDuplicateKey(config, event, storedSession));
});

test("response classification treats duplicate success as logical success", () => {
  assert.equal(responseLooksOk(201, { ok: true, duplicate: false }), true);
  assert.equal(responseLooksOk(200, { ok: false, duplicate: true }), true);
  assert.equal(responseLooksDuplicate(200, { ok: true, duplicate: true }), true);
  assert.equal(responseLooksDuplicate(409, { error: "Submission duplicada" }), true);
});

test("response classification rejects explicit non-duplicate failures", () => {
  assert.equal(responseLooksOk(200, { ok: false }), false);
  assert.equal(responseLooksOk(400, { ok: false }), false);
  assert.equal(responseLooksDuplicate(409, { error: "Semana cerrada" }), false);
});
