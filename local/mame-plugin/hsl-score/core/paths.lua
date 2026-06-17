local M = {}

function M.create(plugin_folder, config)
  local paths = {}

  function paths.now_iso()
    -- UTC ISO estandar.
    -- Evita que Windows/Lua devuelva nombres localizados de zona horaria.
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
  end

  function paths.safe_filename_part(value)
    value = tostring(value or "")
    value = value:gsub("[^%w%-%._%+]", "_")
    return value
  end

  function paths.filename_time_from_iso(value)
    return tostring(value or ""):gsub(":", "-")
  end

  function paths.get_output_dir()
    if config.outputDir and config.outputDir ~= "" then
      return config.outputDir
    end

    return plugin_folder .. "/" .. config.outputSubdir
  end

  return paths
end

return M
