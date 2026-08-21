-- QA-only validation of unrestricted Practice controls in MAME 0.287.
local frame = 0
local lives = nil

local function qa(message)
  emu.print_info("HSL_PRACTICE_QA " .. message)
end

local function resolve_lives()
  for tag, port in pairs(manager.machine.ioport.ports) do
    for name, field in pairs(port.fields) do
      if name == "Lives" then
        lives = field
        qa("DIP_RESOLVED tag=" .. tostring(tag) .. " value=" .. tostring(field.user_value))
        return
      end
    end
  end
end

local subscriptions = {}
subscriptions.pause = emu.add_machine_pause_notifier(function() qa("NOTIFIER pause") end)
subscriptions.resume = emu.add_machine_resume_notifier(function() qa("NOTIFIER resume") end)
subscriptions.save = emu.add_machine_pre_save_notifier(function() qa("NOTIFIER state_save") end)
subscriptions.load = emu.add_machine_post_load_notifier(function() qa("NOTIFIER state_load") end)
emu.register_prestart(resolve_lives)

emu.register_frame_done(function()
  local _keep_subscriptions_alive = subscriptions.pause
  frame = frame + 1
  if frame == 1 and not lives then resolve_lives() end
  if frame == 60 then
    assert(lives, "Lives DIP missing")
    lives.user_value = 1
    qa("DIP_CHANGED value=" .. tostring(lives.user_value))
  elseif frame == 120 then
    qa("ACTION pause_resume")
    emu.pause()
    emu.unpause()
  elseif frame == 180 then
    qa("ACTION state_save")
    manager.machine:save("hsl-practice-qa")
  elseif frame == 240 then
    qa("ACTION state_load")
    manager.machine:load("hsl-practice-qa")
  elseif frame == 360 then
    qa("ACTION exit")
    manager.machine:exit()
  end
end, "frame")
