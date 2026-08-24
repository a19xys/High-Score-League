local function emit(message) emu.print_info("HSL_DIAG " .. message) end
local done = false
local frame = 0
emu.register_frame_done(function()
  frame = frame + 1
  if done then
    if frame >= 60 then manager.machine:exit() end
    return
  end
  done = true
  local machine = manager.machine
  emit("CONTROLS argv_authority")
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
end, "hsl-diagnostic-frame")
