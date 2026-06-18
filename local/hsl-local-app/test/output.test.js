const test = require("node:test");
const assert = require("node:assert/strict");
const { printHelp, printSubmitResult } = require("../src/output");

function captureConsole(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (line = "") => lines.push(String(line));

  try {
    fn();
  } finally {
    console.log = originalLog;
  }

  return lines.join("\n");
}

test("printHelp groups the MVP CLI flow commands", () => {
  const output = captureConsole(() => printHelp());

  assert.match(output, /Diagnostico:\n  node app\.js diagnose/);
  assert.match(output, /Desarrollo:\n  node app\.js sync-plugin \[--dry-run\]/);
  assert.match(output, /Juego:\n  node app\.js play <rom>\n  node app\.js practice <rom>/);
  assert.match(output, /Eventos:[\s\S]*node app\.js scan \[pending\|sent\|failed\]/);
  assert.match(output, /Cuenta:[\s\S]*node app\.js auth-status/);
  assert.match(output, /Subida:\n  node app\.js submit <archivo\.json>\n  node app\.js submit-all/);
});

test("printSubmitResult includes submission context and sent destination", () => {
  const output = captureConsole(() => printSubmitResult({
    action: "sent",
    duplicateKey: "hsl:v1:abc",
    filename: "score.json",
    movedTo: "C:/pack/events/sent/score.json",
    ok: true,
    status: 201,
    submission: {
      endpoint: "https://example.com/api/submissions/ingest",
      game: "Space Invaders",
      rom: "invaders",
      score: 1230,
      weekId: "week-1",
    },
  }));

  assert.match(output, /Archivo: score\.json/);
  assert.match(output, /Juego: Space Invaders \(invaders\)/);
  assert.match(output, /Score: 1230/);
  assert.match(output, /Week: week-1/);
  assert.match(output, /Endpoint: https:\/\/example\.com\/api\/submissions\/ingest/);
  assert.match(output, /Movido a sent:/);
});

test("printSubmitResult explains pending retry cases", () => {
  const output = captureConsole(() => printSubmitResult({
    action: "network_error",
    filename: "score.json",
    message: "Error de red o servidor no accesible",
    ok: false,
    submission: {
      endpoint: "https://example.com/api/submissions/ingest",
      game: "Space Invaders",
      rom: "invaders",
      score: 1230,
      weekId: "week-1",
    },
  }));

  assert.match(output, /El evento sigue en pending para reintentar/);
});
