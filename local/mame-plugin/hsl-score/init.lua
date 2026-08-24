-- license:MIT
-- High Score League - MAME Lua score event writer
-- v0.4.0: captura automatica generica y candidates comprometidos

local exports = {
  name = "hsl-score",
  version = "0.4.0",
  description = "High Score League score event writer",
  license = "MIT",
  author = { name = "High Score League" }
}

local hsl_score = exports
local PLUGIN_VERSION = "0.4.0"

-- MAME deberia llamar a set_folder(path) con la carpeta real del plugin.
-- Dejamos este fallback para instalaciones sencillas.
local plugin_folder = "plugins/hsl-score"

function hsl_score.set_folder(path)
  if type(path) == "string" and path ~= "" then
    plugin_folder = path
  end
end

local function load_module(relative_path)
  local primary = plugin_folder .. "/" .. relative_path
  local ok, module_or_error = pcall(dofile, primary)

  if ok then
    return module_or_error
  end

  local fallback_ok, fallback_module_or_error = pcall(dofile, relative_path)

  if fallback_ok then
    return fallback_module_or_error
  end

  error(
    "[HSL] No pude cargar modulo: "
      .. tostring(relative_path)
      .. " / "
      .. tostring(module_or_error)
      .. " / "
      .. tostring(fallback_module_or_error)
  )
end

function hsl_score.startplugin()
  local config_module = load_module("core/config.lua")
  local json = load_module("core/json.lua")
  local paths_module = load_module("core/paths.lua")
  local helpers_module = load_module("core/mame_helpers.lua")
  local tracking_module = load_module("core/tracking.lua")
  local writer_module = load_module("core/writer.lua")
  local integrity_module = load_module("core/competition_integrity.lua")
  local menu_module = load_module("core/menu.lua")

  local config = config_module.load(plugin_folder, emu)
  local game = load_module(config.gameModule or "games/invaders.lua")

  if type(game) ~= "table" then
    error("[HSL] Adapter invalido: debe exportar una tabla")
  end
  if config.competitionIntegrity ~= nil and type(game.observe_capture) ~= "function" then
    error("[HSL] Adapter invalido: Competicion protegida requiere observe_capture")
  end
  if config.competitionIntegrity == nil
      and (type(game.read_memory) ~= "function" or type(game.build_event) ~= "function") then
    error("[HSL] Adapter legacy invalido: debe exponer read_memory y build_event")
  end

  local paths = paths_module.create(plugin_folder, config)
  local helpers = helpers_module.create(emu, manager)
  local tracker = tracking_module.create(config, game, helpers)
  local integrity = integrity_module.create(config, helpers, json, emu, manager, PLUGIN_VERSION)
  integrity.start()
  if integrity.enabled then
    emu.register_prestart(function()
      integrity.prepare()
    end)
  end
  local writer = writer_module.create(config, paths, json, helpers, tracker, game, PLUGIN_VERSION, integrity)
  local menu = menu_module.create(config, paths, helpers, tracker, writer, game, PLUGIN_VERSION)
  local qa_first_frame = os.getenv("HSL_COMPETITION_QA") == "1"

  math.randomseed(os.time())

  emu.register_menu(menu.callback, menu.populate, "High Score League")

  if config.enableFrameTracking or integrity.enabled then
    emu.register_frame_done(function()
      if qa_first_frame then helpers.print_info("[HSL] QA frame: integrity begin") end
      local integrity_was_active = integrity.get_state() == "armed" or integrity.get_state() == "violated"
      if integrity.enabled then integrity.frame_tick() end
      if qa_first_frame then helpers.print_info("[HSL] QA frame: integrity end; observe begin") end
      local result = config.enableFrameTracking and (not integrity.enabled or integrity_was_active) and tracker.frame_tick() or nil
      if qa_first_frame then helpers.print_info("[HSL] QA frame: observe end"); qa_first_frame = false end
      if integrity.enabled and result then
        if not result.ok then
          integrity.unavailable("observe_capture fallo: " .. tostring(result.error))
        elseif result.candidate and not writer.write_candidate(result.candidate) then
          integrity.unavailable("candidate automatico rechazado")
        end
      end
    end, "hsl-score-frame")
  end

  emu.print_info("[HSL] Plugin v" .. PLUGIN_VERSION .. " cargado")
  emu.print_info("[HSL] Plugin folder: " .. tostring(plugin_folder))
  emu.print_info("[HSL] Game module: " .. tostring(config.gameModule))
  emu.print_info("[HSL] Output dir: " .. tostring(paths.get_output_dir()))
end

return exports
