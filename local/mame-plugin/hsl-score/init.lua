-- license:MIT
-- High Score League - MAME Lua score event writer
-- v0.1.4: Space Invaders / invaders / manual capture + rollover tracker + compact JSON

local exports = {
  name = "hsl-score",
  version = "0.1.4",
  description = "High Score League score event writer",
  license = "MIT",
  author = { name = "High Score League" }
}

local hsl_score = exports

local PLUGIN_VERSION = "0.1.4"

-- MAME debería llamar a set_folder(path) con la carpeta real del plugin.
-- Dejamos este fallback para instalaciones sencillas.
local plugin_folder = "plugins/hsl-score"

function hsl_score.set_folder(path)
  if type(path) == "string" and path ~= "" then
    plugin_folder = path
  end
end

local config = {
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

local menu_actions = {}

local function load_user_config()
  local candidates = {
    plugin_folder .. "/config.lua",
    "config.lua"
  }

  for _, filename in ipairs(candidates) do
    local ok, user_config = pcall(dofile, filename)

    if ok and type(user_config) == "table" then
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

      emu.print_info("[HSL] Config cargada: " .. filename)
      return
    end
  end

  emu.print_info("[HSL] Sin config externa; usando valores por defecto")
end

local function escape_json_string(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  return s
end

local function is_array(t)
  local count = 0
  local max = 0

  for k, _ in pairs(t) do
    if type(k) ~= "number" then
      return false
    end

    count = count + 1

    if k > max then
      max = k
    end
  end

  return count == max
end

local function json_encode(value)
  local tv = type(value)

  if tv == "nil" then
    return "null"
  elseif tv == "boolean" then
    return value and "true" or "false"
  elseif tv == "number" then
    return tostring(value)
  elseif tv == "string" then
    return '"' .. escape_json_string(value) .. '"'
  elseif tv == "table" then
    local parts = {}

    if is_array(value) then
      for i = 1, #value do
        parts[#parts + 1] = json_encode(value[i])
      end

      return "[" .. table.concat(parts, ",") .. "]"
    else
      for k, v in pairs(value) do
        parts[#parts + 1] = json_encode(tostring(k)) .. ":" .. json_encode(v)
      end

      return "{" .. table.concat(parts, ",") .. "}"
    end
  end

  return json_encode(tostring(value))
end

local function now_iso()
  -- UTC ISO estándar.
  -- Evita que Windows/Lua devuelva nombres localizados de zona horaria.
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function safe_filename_part(value)
  value = tostring(value or "")
  value = value:gsub("[^%w%-%._%+]", "_")
  return value
end

local function filename_time_from_iso(value)
  return tostring(value or ""):gsub(":", "-")
end

local function get_output_dir()
  if config.outputDir and config.outputDir ~= "" then
    return config.outputDir
  end

  return plugin_folder .. "/" .. config.outputSubdir
end

local function get_mame_version()
  local ok, value = pcall(function()
    return emu.app_name() .. " " .. emu.app_version()
  end)

  if ok and value then
    return value
  end

  return "unknown"
end

local function get_machine()
  local ok, machine = pcall(function()
    return manager.machine
  end)

  if ok and machine then
    return machine
  end

  local ok2, machine2 = pcall(function()
    return manager:machine()
  end)

  if ok2 and machine2 then
    return machine2
  end

  return nil
end

local function pop_message(message)
  local machine = get_machine()

  if machine then
    pcall(function()
      machine:popmessage(message)
    end)
  end
end

local function get_rom_name()
  local ok, value = pcall(function()
    return emu.romname()
  end)

  if ok and value and value ~= "" then
    return value
  end

  local machine = get_machine()

  if machine then
    local ok2, value2 = pcall(function()
      return machine.system.name
    end)

    if ok2 and value2 and value2 ~= "" then
      return value2
    end
  end

  return "unknown"
end

local function get_game_name()
  local ok, value = pcall(function()
    return emu.gamename()
  end)

  if ok and value and value ~= "" then
    return value
  end

  local machine = get_machine()

  if machine then
    local ok2, value2 = pcall(function()
      return machine.system.description
    end)

    if ok2 and value2 and value2 ~= "" then
      return value2
    end
  end

  return "unknown"
end

local function get_program_space()
  local machine = get_machine()

  if not machine then
    return nil, "No hay manager.machine"
  end

  local ok_cpu, cpu = pcall(function()
    return machine.devices[":maincpu"]
  end)

  if not ok_cpu or not cpu then
    return nil, "No encuentro :maincpu"
  end

  local ok_space, space = pcall(function()
    return cpu.spaces["program"]
  end)

  if not ok_space or not space then
    return nil, "No encuentro espacio program de :maincpu"
  end

  return space, nil
end

local function read_u8(space, addr)
  local ok, value = pcall(function()
    return space:read_u8(addr)
  end)

  if ok then
    return value
  end

  return nil
end

local function bcd_byte_to_int(byte)
  if byte == nil then
    return nil
  end

  local hi = math.floor(byte / 16)
  local lo = byte % 16

  if hi > 9 or lo > 9 then
    return nil
  end

  return hi * 10 + lo
end

local function read_invaders_memory()
  local rom = get_rom_name()
  local game = get_game_name()

  if rom ~= "invaders" then
    return {
      ok = false,
      rom = rom,
      game = game,
      error = "ROM no soportada en esta version: " .. tostring(rom)
    }
  end

  local space, err = get_program_space()

  if not space then
    return {
      ok = false,
      rom = rom,
      game = game,
      error = err or "No se pudo obtener memoria"
    }
  end

  -- Space Invaders P1 score:
  -- 0x20F8 = byte BCD bajo
  -- 0x20F9 = byte BCD alto
  local lsb = read_u8(space, 0x20F8)
  local msb = read_u8(space, 0x20F9)

  local lo = bcd_byte_to_int(lsb)
  local hi = bcd_byte_to_int(msb)

  if lo == nil or hi == nil then
    return {
      ok = false,
      rom = rom,
      game = game,
      error = "Bytes BCD invalidos",
      raw = {
        p1_score_lsb = lsb or -1,
        p1_score_msb = msb or -1
      }
    }
  end

  local visible_score = hi * 100 + lo

  return {
    ok = true,
    rom = rom,
    game = game,
    visibleScore = visible_score,
    raw = {
      p1_score_lsb = lsb,
      p1_score_msb = msb,

      -- Diagnóstico útil para más adelante.
      -- En Space Invaders suele servir para distinguir gameplay/attract:
      -- 1 = gameplay, 0 = demo/attract/entre partidas.
      game_mode_0x20EF = read_u8(space, 0x20EF) or 0,

      -- Datos auxiliares. De momento no dependemos de ellos.
      player1_alive_0x20E7 = read_u8(space, 0x20E7) or 0,
      p1_ships_remaining_0x21FF = read_u8(space, 0x21FF) or 0
    }
  }
end

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

local function update_tracker(reason)
  local result = read_invaders_memory()

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

  -- Transición a partida activa: asumimos partida nueva.
  if tracker.lastGameMode ~= 1 and game_mode == 1 then
    reset_tracker_for_new_run(visible, game_mode)
  end

  -- Rollover de 9990 -> 0000/0010/etc.
  -- Umbrales amplios para evitar falsos positivos por pequeñas fluctuaciones.
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

local function get_capture_score(result)
  if config.enableFrameTracking and tracker.bestScoreThisRun and tracker.bestScoreThisRun > 0 then
    return tracker.bestScoreThisRun
  end

  if result and result.visibleScore then
    return result.visibleScore
  end

  return tracker.trackedScore or tracker.visibleScore or 0
end

local function write_event(reason)
  local result = update_tracker(reason or "manual_capture")

  if not result.ok then
    local msg = "[HSL] No capturo: " .. tostring(result.error)
    emu.print_error(msg)
    pop_message(msg)
    return false
  end

  local detected_at = now_iso()
  local score = get_capture_score(result)

  local event = {
    schemaVersion = 1,
    game = "Space Invaders",
    rom = result.rom,
    score = score,
    detectedAt = detected_at,
    source = "mame_memory",
    mameVersion = get_mame_version(),
    pluginVersion = PLUGIN_VERSION,

    detection = {
      method = "memory_bcd_p1_score_descriptor_with_rollover_tracker",
      manualConfirm = true,
      gameOverDetected = false
    },

    scoreData = {
      displayScore = result.visibleScore,
      trackedScore = tracker.trackedScore,
      bestScoreThisRun = tracker.bestScoreThisRun,
      rollovers = tracker.rollovers
    }
  }

  if config.debugEvent then
    event.debug = {
      reason = reason or "manual_capture",

      memory = {
        scoreAddresses = { "0x20F8", "0x20F9" },
        rawScoreBytes = {
          string.format("0x%02X", result.raw.p1_score_lsb or 0),
          string.format("0x%02X", result.raw.p1_score_msb or 0)
        },
        decode = "two-byte-bcd-visible-score-plus-rollover-tracker",

        tracker = {
          enabled = config.enableFrameTracking,
          intervalFrames = config.trackingIntervalFrames,
          updates = tracker.updates,
          initialized = tracker.initialized,
          trackingOk = tracker.trackingOk,
          lastError = tracker.lastError
        },

        state = {
          gameMode_0x20EF = result.raw.game_mode_0x20EF,
          player1Alive_0x20E7 = result.raw.player1_alive_0x20E7,
          p1ShipsRemaining_0x21FF = result.raw.p1_ships_remaining_0x21FF
        }
      }
    }
  end

  local output_dir = get_output_dir()

  local filename = string.format(
    "%s/%s_%s_%s_%s.json",
    output_dir,
    filename_time_from_iso(detected_at),
    safe_filename_part(result.rom),
    tostring(score),
    tostring(os.time())
  )

  local file = io.open(filename, "w")

  if not file then
    local msg = "[HSL] No pude escribir archivo. Revisa que exista: " .. tostring(output_dir)
    emu.print_error(msg)
    pop_message(msg)
    return false
  end

  file:write(json_encode(event))
  file:write("\n")
  file:close()

  local msg = "[HSL] Evento escrito: " .. filename
  emu.print_info(msg)
  pop_message("HSL: score capturado: " .. tostring(score))

  return true
end

local function reset_tracker_manual()
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

  pop_message("HSL: tracker reseteado")
  return true
end

local function frame_tick()
  if not config.enableFrameTracking then
    return
  end

  tracker.frameCount = tracker.frameCount + 1

  if tracker.frameCount % config.trackingIntervalFrames ~= 0 then
    return
  end

  update_tracker("frame_tracking")
end

function hsl_score.startplugin()
  load_user_config()
  math.randomseed(os.time())

  local function menu_populate()
    menu_actions = {}

    local result = update_tracker("menu_populate")
    local menu = {}

    local function add_action(label, value, action)
      menu[#menu + 1] = { label, value or "", "" }
      menu_actions[#menu] = action
    end

    menu[#menu + 1] = { "High Score League", "", "off" }
    menu[#menu + 1] = { "Version", PLUGIN_VERSION, "off" }
    menu[#menu + 1] = { "ROM", tostring(result.rom or get_rom_name()), "off" }
    menu[#menu + 1] = { "Juego", tostring(result.game or get_game_name()), "off" }

    if result.ok then
      menu[#menu + 1] = { "Score visible P1", tostring(result.visibleScore), "off" }
      menu[#menu + 1] = { "Score capturable", tostring(get_capture_score(result)), "off" }
      menu[#menu + 1] = { "Rollovers", tostring(tracker.rollovers), "off" }

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
    menu[#menu + 1] = { "Tracking updates", tostring(tracker.updates), "off" }
    menu[#menu + 1] = { "Salida", tostring(get_output_dir()), "off" }
    menu[#menu + 1] = { "Debug JSON", config.debugEvent and "ON" or "OFF", "off" }
    menu[#menu + 1] = { "---", "", "" }

    add_action("Capturar score P1 ahora", result.ok and tostring(get_capture_score(result)) or "", function()
      return write_event("manual_menu_capture")
    end)

    add_action("Resetear tracker manualmente", "", function()
      return reset_tracker_manual()
    end)

    return menu
  end

  local function menu_callback(index, event)
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

  emu.register_menu(menu_callback, menu_populate, "High Score League")

  if config.enableFrameTracking then
    emu.register_frame_done(frame_tick, "frame")
  end

  emu.print_info("[HSL] Plugin v" .. PLUGIN_VERSION .. " cargado")
  emu.print_info("[HSL] Plugin folder: " .. tostring(plugin_folder))
  emu.print_info("[HSL] Output dir: " .. tostring(get_output_dir()))
end

return exports