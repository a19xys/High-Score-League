local M = {}

function M.create(config, paths, json, helpers, tracker, game, plugin_version)
  local writer = {}

  function writer.write_event(reason)
    local result = tracker.update(reason or "manual_capture")

    if not result.ok then
      local msg = "[HSL] No capturo: " .. tostring(result.error)
      helpers.print_error(msg)
      helpers.pop_message(msg)
      return false
    end

    local detected_at = paths.now_iso()
    local score = tracker.get_capture_score(result)
    local event = game.build_event(config, tracker.state, result, plugin_version, detected_at, score, helpers)

    if config.debugEvent and event.debug then
      event.debug.reason = reason or "manual_capture"
    end

    local output_dir = paths.get_output_dir()

    local filename = string.format(
      "%s/%s_%s_%s_%s.json",
      output_dir,
      paths.filename_time_from_iso(detected_at),
      paths.safe_filename_part(result.rom),
      tostring(score),
      tostring(os.time())
    )

    local file = io.open(filename, "w")

    if not file then
      local msg = "[HSL] No pude escribir archivo. Revisa que exista: " .. tostring(output_dir)
      helpers.print_error(msg)
      helpers.pop_message(msg)
      return false
    end

    file:write(json.encode(event))
    file:write("\n")
    file:close()

    local msg = "[HSL] Evento escrito: " .. filename
    helpers.print_info(msg)
    helpers.pop_message("HSL: score capturado: " .. tostring(score))

    return true
  end

  return writer
end

return M
