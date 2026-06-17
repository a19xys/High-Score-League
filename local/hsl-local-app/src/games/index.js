const invaders = require("./invaders");

const supportedGames = [invaders];
const gamesByRom = new Map();
const gamesById = new Map();

for (const game of supportedGames) {
  gamesById.set(game.gameId, game);

  for (const rom of game.roms) {
    gamesByRom.set(String(rom).toLowerCase(), game);
  }
}

function normalizeRom(rom) {
  if (typeof rom !== "string") {
    return "";
  }

  return rom.trim().toLowerCase();
}

function getGameByRom(rom) {
  return gamesByRom.get(normalizeRom(rom)) || null;
}

function getPrimaryGameById(gameId) {
  if (typeof gameId !== "string") {
    return null;
  }

  return gamesById.get(gameId) || null;
}

function isSupportedRom(rom) {
  return getGameByRom(rom) !== null;
}

function getTitleByRom(rom) {
  const game = getGameByRom(rom);
  return game ? game.title : null;
}

function listSupportedGames() {
  return supportedGames.slice();
}

function getCompetitionRulesForRom(rom) {
  const game = getGameByRom(rom);
  return game ? game.competition : null;
}

function getPracticeRulesForRom(rom) {
  const game = getGameByRom(rom);
  return game ? game.practice : null;
}

function getCaptureRulesForRom(rom) {
  const game = getGameByRom(rom);
  return game ? game.capture : null;
}

module.exports = {
  getCaptureRulesForRom,
  getCompetitionRulesForRom,
  getGameByRom,
  getPracticeRulesForRom,
  getPrimaryGameById,
  getTitleByRom,
  isSupportedRom,
  listSupportedGames,
};
