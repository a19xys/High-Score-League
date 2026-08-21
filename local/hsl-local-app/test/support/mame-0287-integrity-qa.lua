-- QA-only MAME 0.287 sabotage driver. This file is never copied to a pack or
-- included in a production Competition command line.
local mode = os.getenv("HSL_INTEGRITY_QA_MODE") or "effects"
local frame = 0

local function qa(message)
  emu.print_info("HSL_QA " .. message)
end

emu.register_frame_done(function()
  frame = frame + 1

  if mode == "speed" then
    if frame == 120 then
      qa("VERIFY speed_factor=" .. tostring(manager.machine.video.speed_factor))
      manager.machine:exit()
    end
    return
  end

  if mode == "pause" then
    if frame == 90 then
      qa("ACTION pause_single_step")
      manager.ui.single_step = true
    end
    return
  end

  if frame == 90 then
    qa("ACTION dip_changed")
    manager.machine.ioport.ports[":IN2"]:field(3).user_value = 1
  elseif frame == 150 then
    qa("ACTION state_save")
    manager.machine:save("hsl-integrity-qa")
  elseif frame == 260 then
    qa("ACTION state_load")
    manager.machine:load("hsl-integrity-qa")
  elseif frame == 380 then
    qa("ACTION machine_reset")
    manager.machine:soft_reset()
  elseif frame == 500 then
    qa("ACTION throttle_changed")
    manager.machine.video.throttled = false
  elseif frame == 520 then
    manager.machine.video.throttled = true
    manager.machine.video.throttle_rate = 2
  elseif frame == 540 then
    manager.machine.video.throttle_rate = 1
  elseif frame == 650 then
    local lives = manager.machine.ioport.ports[":IN2"]:field(3).user_value
    qa("VERIFY lives=" .. tostring(lives) .. " throttled=" .. tostring(manager.machine.video.throttled))
    manager.machine:exit()
  end
end, "frame")
