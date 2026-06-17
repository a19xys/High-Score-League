local M = {}

local function escape_json_string(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub('"', '\\"')
  s = s:gsub("\n", "\\n")
  s = s:gsub("\r", "\\r")
  s = s:gsub("\t", "\\t")
  return s
end

local function is_array(t)
  local count = 0
  local max = 0

  for k, _ in pairs(t) do
    if type(k) ~= "number" then
      return false
    end

    count = count + 1

    if k > max then
      max = k
    end
  end

  return count == max
end

function M.encode(value)
  local tv = type(value)

  if tv == "nil" then
    return "null"
  elseif tv == "boolean" then
    return value and "true" or "false"
  elseif tv == "number" then
    return tostring(value)
  elseif tv == "string" then
    return '"' .. escape_json_string(value) .. '"'
  elseif tv == "table" then
    local parts = {}

    if is_array(value) then
      for i = 1, #value do
        parts[#parts + 1] = M.encode(value[i])
      end

      return "[" .. table.concat(parts, ",") .. "]"
    else
      for k, v in pairs(value) do
        parts[#parts + 1] = M.encode(tostring(k)) .. ":" .. M.encode(v)
      end

      return "{" .. table.concat(parts, ",") .. "}"
    end
  end

  return M.encode(tostring(value))
end

return M
