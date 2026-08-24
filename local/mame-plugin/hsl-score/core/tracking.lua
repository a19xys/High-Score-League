local M = {}

function M.create(config, game, helpers)
  local tracker = {
    frameCount = 0,
    updates = 0,
    trackingOk = false,
    lastError = "",
    lastReason = "",
    lastResult = nil
  }
  local api = { state = tracker }

  function api.update(reason)
    tracker.lastReason = reason or "unknown"
    if type(game.read_memory) ~= "function" then
      tracker.trackingOk = false
      tracker.lastError = "adapter sin bridge legacy read_memory"
      return { ok = false, error = tracker.lastError }
    end
    local ok, result = pcall(game.read_memory, helpers)
    if not ok or type(result) ~= "table" then
      tracker.trackingOk = false
      tracker.lastError = ok and "adapter sin resultado" or tostring(result)
      return { ok = false, error = tracker.lastError }
    end
    if result.ok ~= true then
      tracker.trackingOk = false
      tracker.lastError = result.error or "unknown"
      return result
    end
    if type(game.on_memory_result) == "function" then
      local update_ok, update_error = pcall(game.on_memory_result, tracker, result)
      if not update_ok then
        tracker.trackingOk = false
        tracker.lastError = tostring(update_error)
        return { ok = false, error = tracker.lastError }
      end
    end
    tracker.updates = tracker.updates + 1
    tracker.trackingOk = true
    tracker.lastError = ""
    tracker.lastResult = result
    return result
  end

  function api.get_capture_score(result)
    if type(game.get_capture_score) == "function" then return game.get_capture_score(tracker, result) end
    if result and type(result.score) == "number" then return result.score end
    if result and type(result.visibleScore) == "number" then return result.visibleScore end
    return 0
  end

  function api.reset_manual()
    tracker.frameCount = 0
    tracker.updates = 0
    tracker.trackingOk = false
    tracker.lastError = ""
    tracker.lastReason = "manual_reset"
    tracker.lastResult = nil
    if type(game.reset_tracking) == "function" then pcall(game.reset_tracking) end
    helpers.pop_message("HSL: tracker reseteado")
    return true
  end

  function api.frame_tick()
    if not config.enableFrameTracking then return nil end
    tracker.frameCount = tracker.frameCount + 1
    if tracker.frameCount % config.trackingIntervalFrames ~= 0 then return nil end
    tracker.lastReason = "frame_tracking"
    if config.competitionIntegrity ~= nil then
      local ok, candidate = pcall(game.observe_capture, helpers)
      tracker.updates = tracker.updates + 1
      tracker.trackingOk = ok
      tracker.lastError = ok and "" or tostring(candidate)
      return { ok = ok, candidate = ok and candidate or nil, error = ok and nil or tostring(candidate) }
    end
    return api.update("frame_tracking")
  end

  return api
end

return M
