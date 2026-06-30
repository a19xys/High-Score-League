local M = {}

function M.read_memory(helpers)
  local rom = helpers.get_rom_name()
  local game = helpers.get_game_name()

  return {
    ok = false,
    rom = rom,
    game = game,
    error = "Adapter template: implement game-specific memory reading."
  }
end

function M.build_event(config, tracker_state, result, plugin_version, detected_at, score, helpers)
  return {
    schemaVersion = 1,
    game = result.game,
    rom = result.rom,
    score = score,
    detectedAt = detected_at,
    source = "mame_memory",
    mameVersion = helpers.get_mame_version(),
    pluginVersion = plugin_version,
    detection = {
      method = "adapter_template",
      manualConfirm = true,
      gameOverDetected = false
    },
    scoreData = {
      trackedScore = tracker_state.trackedScore,
      bestScoreThisRun = tracker_state.bestScoreThisRun,
      rollovers = tracker_state.rollovers
    }
  }
end

return M
