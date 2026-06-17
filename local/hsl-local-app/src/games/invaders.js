const invaders = {
  gameId: "space-invaders",
  title: "Space Invaders",
  roms: ["invaders"],
  primaryRom: "invaders",
  scoring: {
    type: "score",
    format: "memory_bcd",
    player: 1,
    displayDigits: 4,
    rolloverAt: 10000,
  },
  plugin: {
    supported: true,
    minPluginVersion: "0.1.4",
    gameModule: "invaders",
  },
  capture: {
    manualMenu: true,
    manualHotkey: {
      planned: true,
      implemented: false,
      defaultKey: "F12",
    },
    gameOverAuto: {
      planned: true,
      implemented: false,
    },
  },
  competition: {
    enabled: true,
    allowSaveState: false,
    allowLoadState: false,
    allowRewind: false,
    allowPause: true,
    autoSubmit: true,
  },
  practice: {
    enabled: true,
    allowSaveState: true,
    allowLoadState: true,
    allowRewind: true,
    allowCustomDips: true,
    autoSubmit: false,
  },
  dips: {
    planned: true,
    enforcement: "not_implemented",
    expected: [],
    notes: "DIP rules pending research/confirmation.",
  },
  gameOver: {
    planned: true,
    implemented: false,
    notes: "Detector pending research/validation in MAME memory.",
  },
  launcher: {
    planned: true,
    rom: "invaders",
    displayName: "Space Invaders",
  },
  audit: {
    requireInpForTopScores: false,
    plannedFields: [
      "mode",
      "runId",
      "captureReason",
      "dipState",
      "saveLoadState",
      "gameRuleId",
    ],
  },
};

module.exports = invaders;
