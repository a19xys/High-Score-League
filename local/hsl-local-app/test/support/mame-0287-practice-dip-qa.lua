-- QA-only proof that Practice keeps ordinary mutable MAME DIP behaviour.
local frame = 0

emu.register_frame_done(function()
  frame = frame + 1
  if frame == 60 then
    local field = manager.machine.ioport.ports[":IN2"]:field(3)
    field.user_value = 1
    emu.print_info("HSL_QA PRACTICE lives=" .. tostring(field.user_value) .. " setting=" .. tostring(field.settings[field.user_value]))
  elseif frame == 120 then
    manager.machine:exit()
  end
end, "frame")

