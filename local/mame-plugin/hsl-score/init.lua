-- license:MIT
-- High Score League - MAME Lua score event writer
-- v0.1.5: adapter module selected by config.lua for isolated v2 runs

local exports = {
  name = "hsl-score",
  version = "0.1.5",
  description = "High Score League score event writer",
  license = "MIT",
  author = { name = "High Score League" }
}

local hsl_score = exports
local PLUGIN_VERSION = "0.1.5"

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
  local menu_module = load_module("core/menu.lua")

  local config = config_module.load(plugin_folder, emu)
  local game = load_module(config.gameModule or "games/invaders.lua")

  if type(game) ~= "table" or type(game.read_memory) ~= "function" or type(game.build_event) ~= "function" then
    error("[HSL] Adapter invalido: debe exponer read_memory y build_event")
  end

  local paths = paths_module.create(plugin_folder, config)
  local helpers = helpers_module.create(emu, manager)
  local tracker = tracking_module.create(config, game, helpers)
  local writer = writer_module.create(config, paths, json, helpers, tracker, game, PLUGIN_VERSION)
  local menu = menu_module.create(config, paths, helpers, tracker, writer, game, PLUGIN_VERSION)

  math.randomseed(os.time())

  emu.register_menu(menu.callback, menu.populate, "High Score League")

  if config.enableFrameTracking then
    emu.register_frame_done(function()
      tracker.frame_tick()
    end, "frame")
  end

  emu.print_info("[HSL] Plugin v" .. PLUGIN_VERSION .. " cargado")
  emu.print_info("[HSL] Plugin folder: " .. tostring(plugin_folder))
  emu.print_info("[HSL] Game module: " .. tostring(config.gameModule))
  emu.print_info("[HSL] Output dir: " .. tostring(paths.get_output_dir()))
end

return exports
