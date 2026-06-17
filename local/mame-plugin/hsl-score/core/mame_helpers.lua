local M = {}

function M.create(emu_api, manager_api)
  local helpers = {}

  function helpers.get_mame_version()
    local ok, value = pcall(function()
      return emu_api.app_name() .. " " .. emu_api.app_version()
    end)

    if ok and value then
      return value
    end

    return "unknown"
  end

  function helpers.get_machine()
    local ok, machine = pcall(function()
      return manager_api.machine
    end)

    if ok and machine then
      return machine
    end

    local ok2, machine2 = pcall(function()
      return manager_api:machine()
    end)

    if ok2 and machine2 then
      return machine2
    end

    return nil
  end

  function helpers.pop_message(message)
    local machine = helpers.get_machine()

    if machine then
      pcall(function()
        machine:popmessage(message)
      end)
    end
  end

  function helpers.get_rom_name()
    local ok, value = pcall(function()
      return emu_api.romname()
    end)

    if ok and value and value ~= "" then
      return value
    end

    local machine = helpers.get_machine()

    if machine then
      local ok2, value2 = pcall(function()
        return machine.system.name
      end)

      if ok2 and value2 and value2 ~= "" then
        return value2
      end
    end

    return "unknown"
  end

  function helpers.get_game_name()
    local ok, value = pcall(function()
      return emu_api.gamename()
    end)

    if ok and value and value ~= "" then
      return value
    end

    local machine = helpers.get_machine()

    if machine then
      local ok2, value2 = pcall(function()
        return machine.system.description
      end)

      if ok2 and value2 and value2 ~= "" then
        return value2
      end
    end

    return "unknown"
  end

  function helpers.get_program_space()
    local machine = helpers.get_machine()

    if not machine then
      return nil, "No hay manager.machine"
    end

    local ok_cpu, cpu = pcall(function()
      return machine.devices[":maincpu"]
    end)

    if not ok_cpu or not cpu then
      return nil, "No encuentro :maincpu"
    end

    local ok_space, space = pcall(function()
      return cpu.spaces["program"]
    end)

    if not ok_space or not space then
      return nil, "No encuentro espacio program de :maincpu"
    end

    return space, nil
  end

  function helpers.read_u8(space, addr)
    local ok, value = pcall(function()
      return space:read_u8(addr)
    end)

    if ok then
      return value
    end

    return nil
  end

  function helpers.print_info(message)
    emu_api.print_info(message)
  end

  function helpers.print_error(message)
    emu_api.print_error(message)
  end

  return helpers
end

return M
