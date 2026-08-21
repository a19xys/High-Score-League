-- QA-only Space Invaders input/memory observer for MAME 0.287.
-- It is never copied to a pack or accepted as a protected Competition argument.

local frame = 0
local previous = ""
local previous_mode = nil
local game_started = false
local final_frame = nil
local scored = false
local violation = os.getenv("HSL_AUTO_QA_VIOLATION") or "clean"
local marker = os.getenv("HSL_AUTO_QA_MARKER")
local violation_done = false
local reset_requested = false
local reset_frame = nil
local fields = {}

if marker then
  local marker_file = io.open(marker, "r")
  if marker_file then marker_file:close(); violation_done = true end
end

local function qa(message)
  emu.print_info("HSL_AUTO_QA " .. message)
end

local function program_space()
  local device = manager.machine.devices[":maincpu"]
  return device and device.spaces and device.spaces["program"] or nil
end

local function read_u8(space, address)
  local ok, value = pcall(function() return space:read_u8(address) end)
  return ok and value or -1
end

local function find_field(name)
  for tag, port in pairs(manager.machine.ioport.ports) do
    for field_name, field in pairs(port.fields) do
      if field_name == name then
        qa("FIELD name=" .. name .. " tag=" .. tostring(tag) .. " mask=" .. tostring(field.mask))
        return field
      end
    end
  end
  qa("FIELD_MISSING name=" .. name)
  return nil
end

local function set_field(field, active)
  if not field then return end
  if active then field:set_value(1) else field:clear_value() end
end

local function pulse(field, start_frame, duration)
  if frame == start_frame then set_field(field, true) end
  if frame == start_frame + duration then set_field(field, false) end
end

local function resolve_fields()
  fields.coin = find_field("Coin 1")
  fields.start = find_field("1 Player Start")
  fields.left = find_field("P1 Left")
  fields.right = find_field("P1 Right")
  fields.fire = find_field("P1 Button 1")
  fields.lives = find_field("Lives")
end

emu.register_prestart(resolve_fields)

emu.register_frame_done(function()
  frame = frame + 1
  if reset_requested then
    if not manager.machine.hard_reset_pending and frame >= reset_frame + 120 then
      qa("ACTION exit_after_reset_rebuild")
      manager.machine:exit()
    end
    return
  end
  if frame == 1 and not fields.coin then resolve_fields() end
  if violation_done then
    if frame == 120 then qa("ACTION exit_after_reset"); manager.machine:exit() end
    return
  end
  pulse(fields.coin, 60, 4)
  pulse(fields.start, 120, 4)

  -- Sweep while firing. This produces a genuine emulated attempt without
  -- relying on UI/menu inputs or writing emulated RAM.
  local active_play_window = frame >= 150 and frame < 18000 and not scored
  set_field(fields.fire, active_play_window and ((frame - 150) % 24 < 3))
  if active_play_window then
    local phase = math.floor((frame - 150) / 240) % 2
    set_field(fields.left, phase == 0)
    set_field(fields.right, phase == 1)
  else
    set_field(fields.left, false)
    set_field(fields.right, false)
  end

  local space = program_space()
  if not space then return end
  local lsb = read_u8(space, 0x20F8)
  local msb = read_u8(space, 0x20F9)
  local mode = read_u8(space, 0x20EF)
  local alive = read_u8(space, 0x20E7)
  local ships = read_u8(space, 0x21FF)
  if not scored and (lsb > 0 or msb > 0) then
    scored = true
    qa("SCORE_OBSERVED frame=" .. tostring(frame))
  end
  local signature = table.concat({ mode, alive, ships, lsb, msb }, ",")
  if signature ~= previous or frame % 600 == 0 then
    previous = signature
    qa(string.format("STATE frame=%d mode=%d alive=%d ships=%d score=%02X%02X", frame, mode, alive, ships, msb, lsb))
  end

  if mode == 1 then game_started = true end
  if game_started and previous_mode == 1 and mode == 0 and alive == 0 and ships == 0 and (lsb > 0 or msb > 0) then
    final_frame = frame
    qa("AUTOMATIC_FINAL frame=" .. tostring(frame))
  end
  previous_mode = mode

  if final_frame and frame == final_frame + 30 then
    if violation == "pause" then
      qa("VIOLATION pause")
      emu.pause()
      emu.unpause()
    elseif violation == "dip_changed" then
      qa("VIOLATION dip_changed")
      if fields.lives then fields.lives.user_value = 1 end
    elseif violation == "save_load" then
      qa("VIOLATION state_save")
      manager.machine:save("hsl-qa")
    elseif violation == "reset" then
      qa("VIOLATION hard_reset")
      if marker then
        local marker_file = assert(io.open(marker, "w"))
        marker_file:write("reset-after-candidate\n")
        marker_file:close()
      end
      reset_requested = true
      reset_frame = frame
      fields = {}
      manager.machine:hard_reset()
      return
    end
  end
  if final_frame and frame == final_frame + 75 and violation == "save_load" then
    qa("VIOLATION state_load")
    manager.machine:load("hsl-qa")
  end

  if final_frame and frame >= final_frame + 150 then
    qa("ACTION exit_after_final")
    manager.machine:exit()
    return
  end

  if frame >= 18000 then
    qa("TIMEOUT")
    manager.machine:exit()
  end
end, "frame")
