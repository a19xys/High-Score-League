const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getCaptureRulesForRom,
  getCompetitionRulesForRom,
  getGameByRom,
  getPracticeRulesForRom,
  getPrimaryGameById,
  getTitleByRom,
  isSupportedRom,
  listSupportedGames,
} = require("../src/games");

test("getGameByRom returns the Space Invaders module for invaders", () => {
  const game = getGameByRom("invaders");

  assert.equal(game.gameId, "space-invaders");
  assert.equal(game.title, "Space Invaders");
  assert.equal(game.primaryRom, "invaders");
  assert.deepEqual(game.roms, ["invaders"]);
  assert.deepEqual(game.scoring, {
    type: "score",
    format: "memory_bcd",
    player: 1,
    displayDigits: 4,
    rolloverAt: 10000,
  });
  assert.equal(game.plugin.supported, true);
  assert.equal(game.plugin.minPluginVersion, "0.1.4");
  assert.equal(game.plugin.gameModule, "invaders");
});

test("game registry handles unknown ROMs conservatively", () => {
  assert.equal(getGameByRom("unknown-rom"), null);
  assert.equal(getTitleByRom("unknown-rom"), null);
  assert.equal(isSupportedRom("unknown-rom"), false);
  assert.equal(getCompetitionRulesForRom("unknown-rom"), null);
  assert.equal(getPracticeRulesForRom("unknown-rom"), null);
  assert.equal(getCaptureRulesForRom("unknown-rom"), null);
});

test("game registry lists supported games", () => {
  const games = listSupportedGames();

  assert.equal(games.length, 1);
  assert.equal(games[0].gameId, "space-invaders");
  assert.equal(isSupportedRom("INVADERS"), true);
  assert.equal(getTitleByRom(" invaders "), "Space Invaders");
  assert.equal(getPrimaryGameById("space-invaders").primaryRom, "invaders");
});

test("invaders declares competition rules without applying them", () => {
  const competition = getCompetitionRulesForRom("invaders");

  assert.equal(competition.enabled, true);
  assert.equal(competition.allowSaveState, false);
  assert.equal(competition.allowLoadState, false);
  assert.equal(competition.allowRewind, false);
  assert.equal(competition.allowPause, true);
  assert.equal(competition.autoSubmit, true);
});

test("invaders declares practice rules without applying them", () => {
  const practice = getPracticeRulesForRom("invaders");

  assert.equal(practice.enabled, true);
  assert.equal(practice.allowSaveState, true);
  assert.equal(practice.allowLoadState, true);
  assert.equal(practice.allowRewind, true);
  assert.equal(practice.allowCustomDips, true);
  assert.equal(practice.autoSubmit, false);
});

test("invaders declares planned capture, Game Over, DIPs, launcher, and audit metadata", () => {
  const game = getGameByRom("invaders");

  assert.deepEqual(getCaptureRulesForRom("invaders"), game.capture);
  assert.equal(game.capture.manualMenu, true);
  assert.equal(game.capture.manualHotkey.planned, true);
  assert.equal(game.capture.manualHotkey.implemented, false);
  assert.equal(game.capture.manualHotkey.defaultKey, "F12");
  assert.equal(game.capture.gameOverAuto.planned, true);
  assert.equal(game.capture.gameOverAuto.implemented, false);

  assert.equal(game.dips.planned, true);
  assert.equal(game.dips.enforcement, "not_implemented");
  assert.deepEqual(game.dips.expected, []);

  assert.equal(game.gameOver.planned, true);
  assert.equal(game.gameOver.implemented, false);

  assert.equal(game.launcher.planned, true);
  assert.equal(game.launcher.rom, "invaders");
  assert.equal(game.launcher.displayName, "Space Invaders");

  assert.equal(game.audit.requireInpForTopScores, false);
  assert.ok(game.audit.plannedFields.includes("mode"));
  assert.ok(game.audit.plannedFields.includes("gameRuleId"));
});
