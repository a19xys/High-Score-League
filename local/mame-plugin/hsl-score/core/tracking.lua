local M = {}

function M.create(config, game, helpers)
  local tracker = {
    frameCount = 0,
    initialized = false,

    lastVisibleScore = nil,
    visibleScore = 0,
    trackedScore = 0,
    bestScoreThisRun = 0,
    rollovers = 0,

    lastGameMode = nil,
    currentGameMode = 0,

    updates = 0,
    trackingOk = false,
    lastError = "",
    lastReason = ""
  }

  local api = {
    state = tracker
  }

  local function reset_tracker_for_new_run(visible_score, game_mode)
    tracker.initialized = true
    tracker.lastVisibleScore = visible_score
    tracker.visibleScore = visible_score
    tracker.trackedScore = visible_score
    tracker.bestScoreThisRun = visible_score
    tracker.rollovers = 0
    tracker.currentGameMode = game_mode
    tracker.trackingOk = true
    tracker.lastError = ""
    tracker.lastReason = "new_run"
  end

  function api.update(reason)
    local result = game.read_memory(helpers)

    tracker.lastReason = reason or "unknown"

    if not result.ok then
      tracker.trackingOk = false
      tracker.lastError = result.error or "unknown"
      return result
    end

    local visible = result.visibleScore or 0
    local game_mode = result.raw.game_mode_0x20EF or 0

    -- Primera lectura.
    if not tracker.initialized then
      tracker.initialized = true
      tracker.lastVisibleScore = visible
      tracker.visibleScore = visible
      tracker.trackedScore = visible
      tracker.bestScoreThisRun = 0
      tracker.rollovers = 0
      tracker.currentGameMode = game_mode
      tracker.lastGameMode = game_mode
    end

    -- Transicion a partida activa: asumimos partida nueva.
    if tracker.lastGameMode ~= 1 and game_mode == 1 then
      reset_tracker_for_new_run(visible, game_mode)
    end

    -- Rollover de 9990 -> 0000/0010/etc.
    -- Umbrales amplios para evitar falsos positivos por pequenas fluctuaciones.
    if game_mode == 1 and tracker.lastVisibleScore ~= nil then
      if visible < tracker.lastVisibleScore
        and tracker.lastVisibleScore >= 9000
        and visible <= 1000 then
        tracker.rollovers = tracker.rollovers + 1
      end
    end

    tracker.visibleScore = visible
    tracker.trackedScore = tracker.rollovers * 10000 + visible

    if game_mode == 1 and tracker.trackedScore > tracker.bestScoreThisRun then
      tracker.bestScoreThisRun = tracker.trackedScore
    end

    tracker.lastVisibleScore = visible
    tracker.lastGameMode = game_mode
    tracker.currentGameMode = game_mode
    tracker.trackingOk = true
    tracker.lastError = ""
    tracker.updates = tracker.updates + 1

    result.tracker = {
      visibleScore = tracker.visibleScore,
      trackedScore = tracker.trackedScore,
      bestScoreThisRun = tracker.bestScoreThisRun,
      rollovers = tracker.rollovers,
      currentGameMode = tracker.currentGameMode,
      lastGameMode = tracker.lastGameMode,
      updates = tracker.updates,
      reason = tracker.lastReason
    }

    return result
  end

  function api.get_capture_score(result)
    if config.enableFrameTracking and tracker.bestScoreThisRun and tracker.bestScoreThisRun > 0 then
      return tracker.bestScoreThisRun
    end

    if result and result.visibleScore then
      return result.visibleScore
    end

    return tracker.trackedScore or tracker.visibleScore or 0
  end

  function api.reset_manual()
    tracker.frameCount = 0
    tracker.initialized = false

    tracker.lastVisibleScore = nil
    tracker.visibleScore = 0
    tracker.trackedScore = 0
    tracker.bestScoreThisRun = 0
    tracker.rollovers = 0

    tracker.lastGameMode = nil
    tracker.currentGameMode = 0

    tracker.updates = 0
    tracker.trackingOk = false
    tracker.lastError = ""
    tracker.lastReason = "manual_reset"

    helpers.pop_message("HSL: tracker reseteado")
    return true
  end

  function api.frame_tick()
    if not config.enableFrameTracking then
      return
    end

    tracker.frameCount = tracker.frameCount + 1

    if tracker.frameCount % config.trackingIntervalFrames ~= 0 then
      return
    end

    api.update("frame_tracking")
  end

  return api
end

return M
