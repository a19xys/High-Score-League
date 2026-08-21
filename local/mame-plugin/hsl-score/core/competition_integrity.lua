local M = {}

local VIOLATION_ORDER = {
  "dip_changed", "pause", "state_save", "state_load", "machine_reset",
  "menu_opened", "speed_changed", "throttle_changed", "integrity_unavailable"
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

function M.create(config, helpers, json, emu_api, manager_api, plugin_version)
  local policy = config.competitionIntegrity
  local enabled = type(policy) == "table"
  local state = "disabled"
  local violations = {}
  local notified = false
  local stopping = false
  local stop_observed = false
  local subscriptions = {}
  local write_sequence = 0
  local api = { enabled = enabled }

  local function marker_path(name)
    return tostring(policy.integrityDir) .. "/" .. name
  end

  local function file_exists(filename)
    local file = io.open(filename, "r")
    if not file then return false end
    file:close()
    return true
  end

  local function atomic_write(filename, contents, preserve_existing)
    if preserve_existing and file_exists(filename) then return true end
    write_sequence = write_sequence + 1
    local temporary = filename .. ".tmp-" .. tostring(os.time()) .. "-" .. tostring(write_sequence)
    local file, open_error = io.open(temporary, "w")
    if not file then return false, open_error end
    local ok, write_error = file:write(contents, "\n")
    if not ok then file:close(); os.remove(temporary); return false, write_error end
    local close_ok, close_error = file:close()
    if not close_ok then os.remove(temporary); return false, close_error end
    if preserve_existing and file_exists(filename) then os.remove(temporary); return true end
    if file_exists(filename) then os.remove(filename) end
    local rename_ok, rename_error = os.rename(temporary, filename)
    if not rename_ok then os.remove(temporary); return false, rename_error end
    return true
  end

  local function violation_list()
    local result = {}
    for _, code in ipairs(VIOLATION_ORDER) do
      if violations[code] then result[#result + 1] = code end
    end
    return result
  end

  local function phase_name()
    if next(violations) ~= nil then return "violated" end
    if state == "armed" then return "armed" end
    return "preparing"
  end

  local function state_document()
    return {
      version = 1,
      runId = policy.runId,
      packId = policy.packId,
      phase = phase_name(),
      armed = file_exists(marker_path("armed.marker")),
      stopObserved = stop_observed,
      violations = violation_list()
    }
  end

  local function persist_state()
    local ok, persist_error = atomic_write(marker_path("state.json"), json.encode(state_document()), false)
    if not ok then helpers.print_error("[HSL] No pude persistir state.json: " .. tostring(persist_error)) end
    return ok
  end

  local function persist_marker(name, payload)
    local ok, persist_error = atomic_write(marker_path(name), json.encode(payload), true)
    if not ok then helpers.print_error("[HSL] No pude persistir marker " .. name .. ": " .. tostring(persist_error)) end
    return ok
  end

  local function load_durable_state()
    for _, code in ipairs(VIOLATION_ORDER) do
      if file_exists(marker_path("violation." .. code .. ".marker")) then violations[code] = true end
    end
    notified = next(violations) ~= nil
  end

  local function violate(code, diagnostic)
    if not violations[code] then
      violations[code] = true
      persist_marker("violation." .. code .. ".marker", { version = 1, runId = policy.runId, code = code })
      helpers.print_error("[HSL] Integridad competitiva: " .. code .. (diagnostic and (" (" .. diagnostic .. ")") or ""))
    end
    if state ~= "disabled" then state = "violated" end
    persist_state()
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
    if not ok_class or (type_class ~= "dipswitch" and type_class ~= "configuration") then return nil, "field no es DIP/configuration" end
    local ok_settings, settings = pcall(function() return field.settings end)
    if not ok_settings or type(settings) ~= "table" or settings[dip.value] == nil then return nil, "value no admitido: " .. tostring(dip.value) end
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
    if type(policy.integrityDir) ~= "string" or policy.integrityDir == "" then return false, "integrityDir ausente" end
    if type(policy.manifestSha256) ~= "string" or not policy.manifestSha256:match("^[0-9a-f]+$") or #policy.manifestSha256 ~= 64 then return false, "manifestSha256 invalido" end
    if type(policy.mameVersion) ~= "string" or not policy.mameVersion:match("^%d+%.%d+%.?%d*$") then return false, "mameVersion invalido" end
    if type(policy.dips) ~= "table" or #policy.dips > 32 then return false, "DIP policy invalida" end
    local actual_version = extract_version(emu_api.app_version())
    if actual_version ~= policy.mameVersion then return false, "MAME esperado " .. policy.mameVersion .. ", actual " .. tostring(actual_version) end
    return true, nil
  end

  function api.start()
    if not enabled then return true end
    state = "waiting"
    load_durable_state()
    local valid, policy_error = policy_is_valid()
    if not valid then violate("integrity_unavailable", policy_error); return false end
    persist_state()
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
      local ok_exit, exit_pending = pcall(function() return manager_api.machine.exit_pending end)
      if ok_exit and exit_pending == true then
        stopping = true
        stop_observed = persist_marker("final.marker", {
          version = 1, runId = policy.runId, packId = policy.packId,
          manifestSha256 = policy.manifestSha256, mameVersion = policy.mameVersion,
          pluginVersion = plugin_version, exitPending = true
        })
        if not stop_observed then violate("integrity_unavailable", "no se pudo persistir final seal") end
        persist_state()
      else
        violate("machine_reset", "stop intermedio sin exit_pending")
        stopping = true
      end
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
      if not ok then violate("integrity_unavailable", dip_error); return false end
    end
    state = "prepared"
    persist_state()
    helpers.print_info("[HSL] DIP competitivos preparados antes del ARM")
    return true
  end

  local function monitor_dips()
    for _, dip in ipairs(policy.dips) do
      local actual, dip_error = read_dip(dip)
      if dip_error then violate("integrity_unavailable", dip_error)
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
        if dip_error or actual ~= dip.value then violate("integrity_unavailable", dip_error or "DIP distinto antes de ARM"); return end
      end
      persist_marker("armed.marker", { version = 1, runId = policy.runId })
      state = next(violations) == nil and "armed" or "violated"
      persist_state()
      helpers.print_info("[HSL] Integridad competitiva ARMADA")
    end
    if state ~= "armed" and state ~= "violated" then return end

    monitor_dips()
    local ok_paused, paused = pcall(function() return manager_api.machine.paused end)
    local ok_exit, exit_pending = pcall(function() return manager_api.machine.exit_pending end)
    if not ok_paused then violate("integrity_unavailable", "machine.paused no disponible") elseif paused and not (ok_exit and exit_pending) then violate("pause") end
    local ok_menu, menu_active = pcall(function() return manager_api.ui.menu_active end)
    if not ok_menu then violate("integrity_unavailable", "menu_active no disponible") elseif menu_active then violate("menu_opened") end
    local ok_speed, speed_factor = pcall(function() return manager_api.machine.video.speed_factor end)
    if not ok_speed then violate("integrity_unavailable", "video.speed_factor no disponible") elseif speed_factor ~= 1000 then violate("speed_changed", tostring(speed_factor)) end
    local ok_throttle, throttled = pcall(function() return manager_api.machine.video.throttled end)
    if not ok_throttle then violate("integrity_unavailable", "video.throttled no disponible") elseif throttled ~= true then violate("throttle_changed") end
    local ok_rate, throttle_rate = pcall(function() return manager_api.machine.video.throttle_rate end)
    if not ok_rate or type(throttle_rate) ~= "number" then violate("integrity_unavailable", "video.throttle_rate no disponible") elseif math.abs(throttle_rate - 1) > 0.000001 then violate("throttle_changed", "throttle_rate") end
  end

  function api.snapshot()
    if not enabled then return nil end
    return {
      version = 1, guardVersion = 1, runId = policy.runId,
      packId = policy.packId, manifestSha256 = policy.manifestSha256,
      mameVersion = policy.mameVersion, dips = shallow_copy_dips(policy.dips),
      violations = violation_list()
    }
  end

  api.get_state = function() return state end
  api.get_violations = violation_list
  api.unavailable = function(diagnostic) violate("integrity_unavailable", diagnostic) end
  return api
end

return M
