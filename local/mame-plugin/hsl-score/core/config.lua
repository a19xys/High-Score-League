local M = {}

local function default_config()
  return {
    -- Por defecto:
    -- plugins/hsl-score/events/pending
    outputSubdir = "events/pending",

    -- Si se define outputDir en config.lua, tiene prioridad absoluta.
    -- Ejemplo: outputDir = "C:/high-score-league-local/events/pending"
    outputDir = nil,

    enableFrameTracking = true,
    trackingIntervalFrames = 5,

    -- false = JSON compacto para app local.
    -- true = añade bloque debug con direcciones, raw bytes, tracker y estado.
    debugEvent = false
  }
end

local function apply_user_config(config, user_config)
  if type(user_config.outputSubdir) == "string" and user_config.outputSubdir ~= "" then
    config.outputSubdir = user_config.outputSubdir
  end

  if type(user_config.outputDir) == "string" and user_config.outputDir ~= "" then
    config.outputDir = user_config.outputDir
  end

  if type(user_config.enableFrameTracking) == "boolean" then
    config.enableFrameTracking = user_config.enableFrameTracking
  end

  if type(user_config.trackingIntervalFrames) == "number" and user_config.trackingIntervalFrames >= 1 then
    config.trackingIntervalFrames = math.floor(user_config.trackingIntervalFrames)
  end

  if type(user_config.debugEvent) == "boolean" then
    config.debugEvent = user_config.debugEvent
  end
end

function M.load(plugin_folder, emu_api)
  local config = default_config()

  local candidates = {
    plugin_folder .. "/config.lua",
    "config.lua"
  }

  for _, filename in ipairs(candidates) do
    local ok, user_config = pcall(dofile, filename)

    if ok and type(user_config) == "table" then
      apply_user_config(config, user_config)
      emu_api.print_info("[HSL] Config cargada: " .. filename)
      return config
    end
  end

  emu_api.print_info("[HSL] Sin config externa; usando valores por defecto")
  return config
end

return M
