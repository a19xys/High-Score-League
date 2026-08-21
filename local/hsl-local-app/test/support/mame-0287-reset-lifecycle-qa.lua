-- QA-only MAME 0.287 reset lifecycle observer.
local marker = os.getenv("HSL_RESET_QA_MARKER")
local mode = os.getenv("HSL_RESET_QA_MODE") or "hard"
local frame = 0

local function qa(message)
  emu.print_info("HSL_RESET_QA " .. message)
end

local function marker_exists()
  if not marker then return false end
  local file = io.open(marker, "r")
  if not file then return false end
  file:close()
  return true
end

local resumed = marker_exists()
qa("INIT mode=" .. mode .. " resumed=" .. tostring(resumed))

local subscriptions = {}
subscriptions.reset = emu.add_machine_reset_notifier(function()
  qa("NOTIFIER reset")
end)
subscriptions.stop = emu.add_machine_stop_notifier(function()
  qa("NOTIFIER stop exit_pending=" .. tostring(manager.machine.exit_pending))
end)

emu.register_frame_done(function()
  frame = frame + 1
  if frame ~= 120 then return end
  if resumed or mode == "exit" then
    qa("ACTION exit")
    manager.machine:exit()
    return
  end
  if marker then
    local file = assert(io.open(marker, "w"))
    file:write("reset-requested\n")
    file:close()
  end
  qa("ACTION " .. mode .. "_reset")
  if mode == "soft" then
    manager.machine:soft_reset()
  else
    manager.machine:hard_reset()
  end
  if mode == "soft" then
    emu.register_frame_done(function()
      if frame >= 300 then
        qa("ACTION exit_after_soft")
        manager.machine:exit()
      end
    end, "frame")
  end
end, "frame")

