local function emit(message) emu.print_info("HSL_DIAG " .. message) end
local function get(object, key)
  local ok, value = pcall(function() return object[key] end)
  return ok and value or nil
end

local wanted = {
  "UI_MENU", "UI_PAUSE", "UI_PAUSE_SINGLE", "UI_REWIND_SINGLE",
  "UI_SAVE_STATE", "UI_SAVE_STATE_QUICK", "UI_LOAD_STATE",
  "UI_LOAD_STATE_QUICK", "UI_RESET_MACHINE", "UI_SOFT_RESET",
  "UI_THROTTLE", "UI_FAST_FORWARD", "UI_TOGGLE_CHEAT", "UI_CANCEL"
}

local done = false
emu.register_frame_done(function()
  if done then return end
  done = true
  local machine = manager.machine
  local by_token = {}
  for key, input_type in pairs(machine.ioport.types) do by_token[get(input_type, "token")] = { key, input_type } end
  for _, token in ipairs(wanted) do
    local found = by_token[token]
    if found then
      local seq = machine.ioport:type_seq(found[2], "standard")
      emit("TYPE token=" .. token .. " name=" .. tostring(get(found[2], "name")) ..
        " seq=" .. machine.input:seq_to_tokens(seq) .. " empty=" .. tostring(seq.empty))
    else
      emit("TYPE token=" .. token .. " MISSING")
    end
  end
  for _, mask in ipairs({ 3, 8 }) do
    local field = machine.ioport.ports[":IN2"]:field(mask)
    emit("DIP tag=:IN2 mask=" .. tostring(mask) .. " name=" .. tostring(field.name) ..
      " value=" .. tostring(field.user_value) .. " class=" .. tostring(field.type_class) ..
      " setting=" .. tostring(field.settings[field.user_value]))
  end
  emit("RUNTIME paused=" .. tostring(machine.paused) ..
    " speed_factor=" .. tostring(machine.video.speed_factor) ..
    " throttled=" .. tostring(machine.video.throttled) ..
    " throttle_rate=" .. tostring(machine.video.throttle_rate) ..
    " menu_active=" .. tostring(manager.ui.menu_active))
  machine:exit()
end, "frame")
