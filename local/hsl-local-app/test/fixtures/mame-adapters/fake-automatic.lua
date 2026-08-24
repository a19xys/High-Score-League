local M = {}
local observations = 0

function M.observe_capture(_helpers)
  observations = observations + 1
  if observations == 3 then
    return { score = 42, metadata = { gameOverDetected = true, fixture = "generic" } }
  end
  return nil
end

return M
