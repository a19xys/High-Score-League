local M = {}
local attempt_active = false
local attempt_saw_alive = false
local last_observed_mode = nil

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

function M.observe_capture(tracker_state, result)
  if type(result) ~= "table" or result.ok ~= true or type(result.raw) ~= "table" then return nil end
  local mode = result.raw.game_mode_0x20EF or 0
  local alive = result.raw.player1_alive_0x20E7 or 0
  local ships = result.raw.p1_ships_remaining_0x21FF or 0

  if not attempt_active and last_observed_mode ~= 1 and mode == 1 then
    attempt_active = true
    attempt_saw_alive = alive == 1
  elseif attempt_active and alive == 1 then
    attempt_saw_alive = true
  end

  local candidate = nil
  if attempt_active and last_observed_mode == 1 and mode == 0 then
    local score = tracker_state.bestScoreThisRun or 0
    if attempt_saw_alive and alive == 0 and ships == 0 and score > 0 then
      candidate = {
        score = score,
        metadata = {
          gameOverDetected = true,
          finalGameMode = mode,
          playerAlive = alive,
          shipsRemaining = ships,
          displayScore = result.visibleScore,
          trackedScore = tracker_state.trackedScore,
          rollovers = tracker_state.rollovers
        }
      }
    end
    attempt_active = false
    attempt_saw_alive = false
  end

  last_observed_mode = mode
  return candidate
end

function M.read_memory(helpers)
  local rom = helpers.get_rom_name()
  local game = helpers.get_game_name()

  if rom ~= "invaders" then
    return {
      ok = false,
      rom = rom,
      game = game,
      error = "ROM no soportada en esta version: " .. tostring(rom)
    }
  end

  local space, err = helpers.get_program_space()

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
  local lsb = helpers.read_u8(space, 0x20F8)
  local msb = helpers.read_u8(space, 0x20F9)

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

      -- Diagnostico util para mas adelante.
      -- En Space Invaders suele servir para distinguir gameplay/attract:
      -- 1 = gameplay, 0 = demo/attract/entre partidas.
      game_mode_0x20EF = helpers.read_u8(space, 0x20EF) or 0,

      -- Datos auxiliares. De momento no dependemos de ellos.
      player1_alive_0x20E7 = helpers.read_u8(space, 0x20E7) or 0,
      p1_ships_remaining_0x21FF = helpers.read_u8(space, 0x21FF) or 0
    }
  }
end

function M.build_event(config, tracker_state, result, plugin_version, detected_at, score, helpers)
  local event = {
    schemaVersion = 1,
    game = "Space Invaders",
    rom = result.rom,
    score = score,
    detectedAt = detected_at,
    source = "mame_memory",
    mameVersion = helpers.get_mame_version(),
    pluginVersion = plugin_version,

    detection = {
      method = "memory_bcd_p1_score_descriptor_with_rollover_tracker",
      manualConfirm = true,
      gameOverDetected = false
    },

    scoreData = {
      displayScore = result.visibleScore,
      trackedScore = tracker_state.trackedScore,
      bestScoreThisRun = tracker_state.bestScoreThisRun,
      rollovers = tracker_state.rollovers
    }
  }

  if config.debugEvent then
    event.debug = {
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
          updates = tracker_state.updates,
          initialized = tracker_state.initialized,
          trackingOk = tracker_state.trackingOk,
          lastError = tracker_state.lastError
        },

        state = {
          gameMode_0x20EF = result.raw.game_mode_0x20EF,
          player1Alive_0x20E7 = result.raw.player1_alive_0x20E7,
          p1ShipsRemaining_0x21FF = result.raw.p1_ships_remaining_0x21FF
        }
      }
    }
  end

  return event
end

return M
