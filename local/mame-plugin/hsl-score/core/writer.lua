local M = {}

function M.create(config, paths, json, helpers, tracker, game, plugin_version)
  local writer = {}
  local capture_sequence = 0

  local function file_exists(filename)
    local file = io.open(filename, "r")

    if not file then
      return false
    end

    file:close()
    return true
  end

  local function reserve_event_paths(output_dir, detected_at, rom, score)
    for _ = 1, 1000 do
      capture_sequence = capture_sequence + 1
      local final_filename = string.format(
        "%s/%s_%s_%s_%s_%06d.json",
        output_dir,
        paths.filename_time_from_iso(detected_at),
        paths.safe_filename_part(rom),
        tostring(score),
        tostring(os.time()),
        capture_sequence
      )
      local temporary_filename = final_filename .. ".tmp"

      if not file_exists(final_filename) and not file_exists(temporary_filename) then
        return final_filename, temporary_filename
      end
    end

    return nil, nil
  end

  local function publication_error(message)
    local full_message = "[HSL] No pude publicar el evento: " .. tostring(message)
    helpers.print_error(full_message)
    helpers.pop_message(full_message)
    return false
  end

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

    local filename, temporary_filename = reserve_event_paths(output_dir, detected_at, result.rom, score)

    if not filename then
      return publication_error("no hay un nombre libre en " .. tostring(output_dir))
    end

    local encoded_event = json.encode(event)
    local file, open_error = io.open(temporary_filename, "w")

    if not file then
      return publication_error(open_error or ("no se pudo abrir el temporal en " .. tostring(output_dir)))
    end

    local write_ok, write_error = file:write(encoded_event, "\n")

    if not write_ok then
      file:close()
      return publication_error(write_error or ("fallo al escribir " .. tostring(temporary_filename)))
    end

    local close_ok, close_error = file:close()

    if not close_ok then
      return publication_error(close_error or ("fallo al cerrar " .. tostring(temporary_filename)))
    end

    if file_exists(filename) then
      return publication_error("el destino final ya existe; se conserva el temporal " .. tostring(temporary_filename))
    end

    local rename_ok, rename_error = os.rename(temporary_filename, filename)

    if not rename_ok then
      return publication_error(rename_error or ("fallo al renombrar " .. tostring(temporary_filename)))
    end

    local msg = "[HSL] Evento escrito: " .. filename
    helpers.print_info(msg)
    helpers.pop_message("HSL: score capturado: " .. tostring(score))

    return true
  end

  return writer
end

return M
