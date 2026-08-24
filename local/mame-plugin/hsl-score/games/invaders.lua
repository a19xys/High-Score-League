local M = {}
local state = {}

local function reset_state()
  state.attemptActive = false
  state.attemptSawAlive = false
  state.lastMode = nil
  state.lastVisibleScore = nil
  state.visibleScore = 0
  state.trackedScore = 0
  state.bestScore = 0
  state.rollovers = 0
end

reset_state()

local function bcd_byte_to_int(byte)
  if byte == nil then return nil end
  local hi = math.floor(byte / 16)
  local lo = byte % 16
  if hi > 9 or lo > 9 then return nil end
  return hi * 10 + lo
end

local function read_snapshot(helpers)
  local rom = helpers.get_rom_name()
  local game = helpers.get_game_name()
  if rom ~= "invaders" then return { ok = false, rom = rom, game = game, error = "ROM no soportada: " .. tostring(rom) } end
  local space, err = helpers.get_program_space()
  if not space then return { ok = false, rom = rom, game = game, error = err or "No se pudo obtener memoria" } end
  local lsb = helpers.read_u8(space, 0x20F8)
  local msb = helpers.read_u8(space, 0x20F9)
  local lo = bcd_byte_to_int(lsb)
  local hi = bcd_byte_to_int(msb)
  if lo == nil or hi == nil then return { ok = false, rom = rom, game = game, error = "Bytes BCD invalidos" } end
  return {
    ok = true,
    rom = rom,
    game = game,
    visibleScore = hi * 100 + lo,
    raw = {
      p1_score_lsb = lsb,
      p1_score_msb = msb,
      game_mode_0x20EF = helpers.read_u8(space, 0x20EF) or 0,
      player1_alive_0x20E7 = helpers.read_u8(space, 0x20E7) or 0,
      p1_ships_remaining_0x21FF = helpers.read_u8(space, 0x21FF) or 0
    }
  }
end

local function update_attempt(result)
  local visible = result.visibleScore or 0
  local mode = result.raw.game_mode_0x20EF or 0
  local alive = result.raw.player1_alive_0x20E7 or 0
  local ships = result.raw.p1_ships_remaining_0x21FF or 0
  if not state.attemptActive and state.lastMode ~= 1 and mode == 1 then
    state.attemptActive = true
    state.attemptSawAlive = alive == 1
    state.rollovers = 0
    state.bestScore = 0
    state.lastVisibleScore = visible
  elseif state.attemptActive and alive == 1 then
    state.attemptSawAlive = true
  end
  if state.attemptActive and state.lastVisibleScore ~= nil and visible < state.lastVisibleScore
      and state.lastVisibleScore >= 9000 and visible <= 1000 then
    state.rollovers = state.rollovers + 1
  end
  state.visibleScore = visible
  state.trackedScore = state.rollovers * 10000 + visible
  if state.attemptActive and state.trackedScore > state.bestScore then state.bestScore = state.trackedScore end
  local candidate = nil
  if state.attemptActive and state.lastMode == 1 and mode == 0 then
    if state.attemptSawAlive and alive == 0 and ships == 0 and state.bestScore > 0 then
      candidate = {
        score = state.bestScore,
        metadata = {
          gameOverDetected = true,
          finalGameMode = mode,
          playerAlive = alive,
          shipsRemaining = ships,
          displayScore = state.visibleScore,
          trackedScore = state.trackedScore,
          rollovers = state.rollovers
        }
      }
    end
    state.attemptActive = false
    state.attemptSawAlive = false
  end
  state.lastVisibleScore = visible
  state.lastMode = mode
  return candidate
end

function M.observe_capture(helpers)
  local result = read_snapshot(helpers)
  if result.ok ~= true then error(result.error or "lectura de memoria fallida") end
  return update_attempt(result)
end

function M.read_memory(helpers) return read_snapshot(helpers) end
function M.get_capture_score(_, result) return result and result.visibleScore or 0 end
function M.reset_tracking() reset_state() end

function M.build_event(config, tracker_state, result, plugin_version, detected_at, score, helpers)
  return {
    schemaVersion = 1,
    game = "Space Invaders",
    rom = result.rom,
    score = score,
    detectedAt = detected_at,
    source = "mame_memory",
    mameVersion = helpers.get_mame_version(),
    pluginVersion = plugin_version,
    detection = { method = "memory_bcd_p1_score_legacy", manualConfirm = true, gameOverDetected = false },
    scoreData = { displayScore = result.visibleScore, trackedScore = result.visibleScore, rollovers = 0 }
  }
end

return M
