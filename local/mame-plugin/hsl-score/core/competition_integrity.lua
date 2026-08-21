local M = {}

local VIOLATION_ORDER = {
  "dip_changed",
  "pause",
  "state_save",
  "state_load",
  "machine_reset",
  "menu_opened",
  "speed_changed",
  "throttle_changed",
  "integrity_unavailable"
}

local function shallow_copy_dips(dips)
  local result = {}
  for index, dip in ipairs(dips or {}) do
    result[index] = { portTag = dip.portTag, mask = dip.mask, value = dip.value }
  end
  return result
end

local function extract_version(value)
  return tostring(value or ""):match("(%d+%.%d+%.?%d*)")
end

function M.create(config, helpers, emu_api, manager_api)
  local policy = config.competitionIntegrity
  local enabled = type(policy) == "table"
  local state = "disabled"
  local violations = {}
  local notified = false
  local stopping = false
  local subscriptions = {}
  local api = { enabled = enabled }

  local function violation_list()
    local result = {}
    for _, code in ipairs(VIOLATION_ORDER) do
      if violations[code] then result[#result + 1] = code end
    end
    return result
  end

  local function violate(code, diagnostic)
    if not violations[code] then
      violations[code] = true
      helpers.print_error("[HSL] Integridad competitiva: " .. code .. (diagnostic and (" (" .. diagnostic .. ")") or ""))
    end
    if state ~= "disabled" then state = "violated" end
    if not notified then
      notified = true
      helpers.pop_message("Esta partida ya no es válida para Competición. Puedes seguir jugando, pero la puntuación no contará.")
    end
  end

  local function resolve_field(dip)
    local ok_port, port = pcall(function() return manager_api.machine.ioport.ports[dip.portTag] end)
    if not ok_port or not port then return nil, "portTag inexistente: " .. tostring(dip.portTag) end
    local ok_field, field = pcall(function() return port:field(dip.mask) end)
    if not ok_field or not field then return nil, "mask inexistente: " .. tostring(dip.mask) end
    local ok_class, type_class = pcall(function() return field.type_class end)
    if not ok_class or (type_class ~= "dipswitch" and type_class ~= "configuration") then
      return nil, "field no es DIP/configuration"
    end
    local ok_settings, settings = pcall(function() return field.settings end)
    if not ok_settings or type(settings) ~= "table" or settings[dip.value] == nil then
      return nil, "value no admitido: " .. tostring(dip.value)
    end
    return field, nil
  end

  local function read_dip(dip)
    local field, field_error = resolve_field(dip)
    if not field then return nil, field_error end
    local ok, value = pcall(function() return field.user_value end)
    if not ok or type(value) ~= "number" then return nil, "no se pudo leer user_value" end
    return value, nil, field
  end

  local function apply_dip(dip)
    local _, read_error, field = read_dip(dip)
    if not field then return false, read_error end
    local ok = pcall(function() field.user_value = dip.value end)
    if not ok then return false, "fallo al escribir user_value" end
    local actual, verify_error = read_dip(dip)
    if verify_error or actual ~= dip.value then return false, verify_error or "relectura no coincide" end
    return true, nil
  end

  local function policy_is_valid()
    if policy.version ~= 1 or policy.guardVersion ~= 1 then return false, "version de guard no soportada" end
    if type(policy.runId) ~= "string" or policy.runId == "" then return false, "runId ausente" end
    if type(policy.packId) ~= "string" or policy.packId == "" then return false, "packId ausente" end
    if type(policy.manifestSha256) ~= "string" or not policy.manifestSha256:match("^[0-9a-f]+$") or #policy.manifestSha256 ~= 64 then
      return false, "manifestSha256 invalido"
    end
    if type(policy.mameVersion) ~= "string" or not policy.mameVersion:match("^%d+%.%d+%.?%d*$") then return false, "mameVersion invalido" end
    if type(policy.dips) ~= "table" or #policy.dips == 0 or #policy.dips > 32 then return false, "DIP policy invalida" end
    local actual_version = extract_version(emu_api.app_version())
    if actual_version ~= policy.mameVersion then return false, "MAME esperado " .. policy.mameVersion .. ", actual " .. tostring(actual_version) end
    return true, nil
  end

  function api.start()
    if not enabled then return true end
    state = "waiting"
    local valid, policy_error = policy_is_valid()
    if not valid then
      violate("integrity_unavailable", policy_error)
      return false
    end
    subscriptions.pause = emu_api.add_machine_pause_notifier(function()
      local ok_exit, exit_pending = pcall(function() return manager_api.machine.exit_pending end)
      if not stopping and not (ok_exit and exit_pending) and (state == "armed" or state == "violated") then violate("pause") end
    end)
    subscriptions.pre_save = emu_api.add_machine_pre_save_notifier(function()
      if state == "armed" or state == "violated" then violate("state_save") end
    end)
    subscriptions.post_load = emu_api.add_machine_post_load_notifier(function()
      if state == "armed" or state == "violated" then violate("state_load") end
    end)
    subscriptions.reset = emu_api.add_machine_reset_notifier(function()
      if state == "armed" or state == "violated" then violate("machine_reset") end
    end)
    subscriptions.stop = emu_api.add_machine_stop_notifier(function()
      stopping = true
      local final_violations = violation_list()
      helpers.print_info("[HSL] Integridad competitiva final: " .. (#final_violations == 0 and "CLEAN" or table.concat(final_violations, ",")))
    end)
    return true
  end

  function api.prepare()
    if not enabled or state ~= "waiting" then return state == "prepared" end
    state = "preparing"
    for _, dip in ipairs(policy.dips) do
      local ok, dip_error = apply_dip(dip)
      if not ok then
        violate("integrity_unavailable", dip_error)
        return false
      end
    end
    state = "prepared"
    helpers.print_info("[HSL] DIP competitivos preparados antes del ARM")
    return true
  end

  local function monitor_dips()
    for _, dip in ipairs(policy.dips) do
      local actual, dip_error = read_dip(dip)
      if dip_error then
        violate("integrity_unavailable", dip_error)
      elseif actual ~= dip.value then
        violate("dip_changed", tostring(dip.portTag) .. "/" .. tostring(dip.mask))
        apply_dip(dip)
      end
    end
  end

  function api.frame_tick()
    if not enabled or state == "disabled" or stopping then return end
    if state == "prepared" then
      for _, dip in ipairs(policy.dips) do
        local actual, dip_error = read_dip(dip)
        if dip_error or actual ~= dip.value then
          violate("integrity_unavailable", dip_error or "DIP distinto antes de ARM")
          return
        end
      end
      state = "armed"
      helpers.print_info("[HSL] Integridad competitiva ARMADA")
    end
    if state ~= "armed" and state ~= "violated" then return end

    monitor_dips()
    local ok_paused, paused = pcall(function() return manager_api.machine.paused end)
    local ok_exit, exit_pending = pcall(function() return manager_api.machine.exit_pending end)
    if not ok_paused then violate("integrity_unavailable", "machine.paused no disponible")
    elseif paused and not (ok_exit and exit_pending) then violate("pause") end

    local ok_menu, menu_active = pcall(function() return manager_api.ui.menu_active end)
    if not ok_menu then violate("integrity_unavailable", "menu_active no disponible")
    elseif menu_active then violate("menu_opened") end

    local ok_speed, speed_factor = pcall(function() return manager_api.machine.video.speed_factor end)
    if not ok_speed then violate("integrity_unavailable", "video.speed_factor no disponible")
    elseif speed_factor ~= 1000 then violate("speed_changed", tostring(speed_factor)) end

    local ok_throttle, throttled = pcall(function() return manager_api.machine.video.throttled end)
    if not ok_throttle then violate("integrity_unavailable", "video.throttled no disponible")
    elseif throttled ~= true then violate("throttle_changed") end

    local ok_rate, throttle_rate = pcall(function() return manager_api.machine.video.throttle_rate end)
    if not ok_rate or type(throttle_rate) ~= "number" then
      violate("integrity_unavailable", "video.throttle_rate no disponible")
    elseif math.abs(throttle_rate - 1) > 0.000001 then
      violate("throttle_changed", "throttle_rate")
    end
  end

  function api.evidence()
    if not enabled then return nil end
    if state ~= "armed" and state ~= "violated" then violate("integrity_unavailable", "evidence antes de ARM") end
    return {
      version = 1,
      guardVersion = 1,
      runId = policy.runId,
      packId = policy.packId,
      manifestSha256 = policy.manifestSha256,
      mameVersion = policy.mameVersion,
      dips = shallow_copy_dips(policy.dips),
      violations = violation_list()
    }
  end

  api.get_state = function() return state end
  api.get_violations = violation_list
  return api
end

return M
