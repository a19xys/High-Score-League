const test = require("node:test");
const assert = require("node:assert/strict");
const {
  eventResultToQueueItem,
  summarizeDiagnoseReport,
} = require("../gui/launcher-service");

test("summarizeDiagnoseReport keeps counts without exposing raw tokens", () => {
  const report = {
    errors: [{ level: "ERROR", message: "missing dir" }],
    recommendations: ["fix config", "fix config"],
    sections: {
      config: [
        { level: "OK", message: "config cargado", detail: null },
        { level: "WARN", message: "supabaseAnonKey configurado", detail: null },
      ],
      session: [
        { level: "OK", message: "sesion local encontrada", detail: "C:/session.json" },
      ],
    },
    warnings: [{ level: "WARN", message: "warning" }],
  };

  const summary = summarizeDiagnoseReport(report);

  assert.equal(summary.errorCount, 1);
  assert.equal(summary.warningCount, 1);
  assert.equal(summary.recommendationCount, 1);
  assert.deepEqual(summary.sections[0].counts, { OK: 1, WARN: 1 });
  assert.equal(JSON.stringify(summary).includes("access_token"), false);
});

test("eventResultToQueueItem maps local event files to renderer-safe rows", () => {
  const row = eventResultToQueueItem("pending", {
    errors: [],
    event: {
      detectedAt: "2026-05-24T22:08:00Z",
      game: "Space Invaders",
      rom: "invaders",
      score: 4320,
      source: "mame_memory",
    },
    filename: "score.json",
    fullPath: "C:/pack/events/pending/score.json",
    ok: true,
    warnings: ["manual confirm"],
  });

  assert.deepEqual(row, {
    box: "pending",
    detectedAt: "2026-05-24T22:08:00Z",
    errors: [],
    filename: "score.json",
    fullPath: "C:/pack/events/pending/score.json",
    game: "Space Invaders",
    ok: true,
    rom: "invaders",
    score: 4320,
    source: "mame_memory",
    warnings: ["manual confirm"],
  });
});
