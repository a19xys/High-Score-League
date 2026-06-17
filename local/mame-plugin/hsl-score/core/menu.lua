local M = {}

function M.create(config, paths, helpers, tracker, writer, game, plugin_version)
  local menu_actions = {}
  local menu_api = {}

  function menu_api.populate()
    menu_actions = {}

    local result = tracker.update("menu_populate")
    local menu = {}

    local function add_action(label, value, action)
      menu[#menu + 1] = { label, value or "", "" }
      menu_actions[#menu] = action
    end

    menu[#menu + 1] = { "High Score League", "", "off" }
    menu[#menu + 1] = { "Version", plugin_version, "off" }
    menu[#menu + 1] = { "ROM", tostring(result.rom or helpers.get_rom_name()), "off" }
    menu[#menu + 1] = { "Juego", tostring(result.game or helpers.get_game_name()), "off" }

    if result.ok then
      menu[#menu + 1] = { "Score visible P1", tostring(result.visibleScore), "off" }
      menu[#menu + 1] = { "Score capturable", tostring(tracker.get_capture_score(result)), "off" }
      menu[#menu + 1] = { "Rollovers", tostring(tracker.state.rollovers), "off" }

      menu[#menu + 1] = {
        "Raw 20F8/20F9",
        string.format("0x%02X 0x%02X", result.raw.p1_score_lsb or 0, result.raw.p1_score_msb or 0),
        "off"
      }

      menu[#menu + 1] = { "Game mode 0x20EF", tostring(result.raw.game_mode_0x20EF), "off" }
    else
      menu[#menu + 1] = { "Estado", tostring(result.error), "off" }
    end

    menu[#menu + 1] = { "Tracking", config.enableFrameTracking and "ON" or "OFF", "off" }
    menu[#menu + 1] = { "Tracking updates", tostring(tracker.state.updates), "off" }
    menu[#menu + 1] = { "Salida", tostring(paths.get_output_dir()), "off" }
    menu[#menu + 1] = { "Debug JSON", config.debugEvent and "ON" or "OFF", "off" }
    menu[#menu + 1] = { "---", "", "" }

    add_action("Capturar score P1 ahora", result.ok and tostring(tracker.get_capture_score(result)) or "", function()
      return writer.write_event("manual_menu_capture")
    end)

    add_action("Resetear tracker manualmente", "", function()
      return tracker.reset_manual()
    end)

    return menu
  end

  function menu_api.callback(index, event)
    if event ~= "select" then
      return false
    end

    local action = menu_actions[index]

    if action then
      action()
      return true
    end

    return false
  end

  return menu_api
end

return M
