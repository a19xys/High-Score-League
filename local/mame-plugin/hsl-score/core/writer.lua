local M = {}

local MAX_DEPTH = 4
local MAX_KEYS = 32
local MAX_ARRAY = 64
local MAX_NODES = 256
local MAX_STRING = 512

local function finite_number(value)
  return value == value and value ~= math.huge and value ~= -math.huge
end

local function sanitize_json(value, depth, budget)
  local value_type = type(value)
  budget.count = budget.count + 1
  if budget.count > MAX_NODES then return nil, "metadata supera el limite de nodos" end
  if value_type == "nil" or value_type == "boolean" then return value, nil end
  if value_type == "number" then
    if not finite_number(value) then return nil, "metadata contiene NaN/Infinity" end
    return value, nil
  end
  if value_type == "string" then
    if #value > MAX_STRING then return nil, "metadata contiene un string demasiado largo" end
    return value, nil
  end
  if value_type ~= "table" then return nil, "metadata contiene un tipo no JSON: " .. value_type end
  if getmetatable(value) ~= nil then return nil, "metadata contiene una metatable" end
  if depth >= MAX_DEPTH then return nil, "metadata supera la profundidad maxima" end

  local count = 0
  local numeric = true
  local maximum = 0
  for key, _ in next, value do
    count = count + 1
    if count > MAX_KEYS then return nil, "metadata supera el limite de keys" end
    if type(key) == "number" and key >= 1 and key == math.floor(key) then
      if key > maximum then maximum = key end
    else
      numeric = false
      if type(key) ~= "string" or #key == 0 or #key > 64 then return nil, "metadata contiene una key invalida" end
    end
  end
  if numeric and maximum > MAX_ARRAY then return nil, "metadata supera el limite de array" end
  if numeric and maximum ~= count then return nil, "metadata contiene un array disperso" end

  local clean = {}
  for key, child in next, value do
    local sanitized, child_error = sanitize_json(child, depth + 1, budget)
    if child_error then return nil, child_error end
    clean[key] = sanitized
  end
  return clean, nil
end

function M.create(config, paths, json, helpers, tracker, game, plugin_version, integrity)
  local writer = {}
  local capture_sequence = 0

  local function file_exists(filename)
    local file = io.open(filename, "r")
    if not file then return false end
    file:close()
    return true
  end

  local function publication_error(message)
    local full_message = "[HSL] No pude publicar captura: " .. tostring(message)
    helpers.print_error(full_message)
    helpers.pop_message(full_message)
    return false
  end

  local function reserve_path(output_dir, detected_at, rom, score, kind)
    for _ = 1, 1000 do
      capture_sequence = capture_sequence + 1
      local basename = string.format(
        "%s_%s_%s_%s_%06d",
        paths.filename_time_from_iso(detected_at),
        paths.safe_filename_part(rom), tostring(score), kind, capture_sequence
      )
      local filename = output_dir .. "/" .. basename .. ".json"
      local temporary = filename .. ".tmp"
      if not file_exists(filename) and not file_exists(temporary) then return filename, temporary, basename end
    end
    return nil, nil, nil
  end

  local function write_json(output_dir, detected_at, rom, score, kind, value)
    local filename, temporary, basename = reserve_path(output_dir, detected_at, rom, score, kind)
    if not filename then return nil, "no hay un nombre libre en " .. tostring(output_dir) end
    local file, open_error = io.open(temporary, "w")
    if not file then return nil, open_error end
    local ok, write_error = file:write(json.encode(value), "\n")
    if not ok then file:close(); return nil, write_error end
    local close_ok, close_error = file:close()
    if not close_ok then return nil, close_error end
    if file_exists(filename) then return nil, "el destino final ya existe" end
    local rename_ok, rename_error = os.rename(temporary, filename)
    if not rename_ok then return nil, rename_error end
    return { filename = filename, basename = basename }, nil
  end

  local function validate_candidate_request(request)
    if type(request) ~= "table" or getmetatable(request) ~= nil then return nil, "candidate debe ser una tabla plana" end
    for key, _ in next, request do
      if key ~= "score" and key ~= "metadata" then return nil, "candidate contiene un campo no permitido: " .. tostring(key) end
    end
    local score = rawget(request, "score")
    if type(score) ~= "number" or not finite_number(score) or score ~= math.floor(score) or score <= 0 or score > 999999999 then
      return nil, "score de candidate invalido"
    end
    local metadata, metadata_error = sanitize_json(rawget(request, "metadata"), 0, { count = 0 })
    if metadata_error then return nil, metadata_error end
    if metadata == nil then metadata = {} end
    return { score = score, metadata = metadata }, nil
  end

  function writer.write_candidate(request)
    if not integrity or not integrity.enabled then return publication_error("candidate competitivo fuera de una run protegida") end
    local candidate, candidate_error = validate_candidate_request(request)
    if not candidate then return publication_error(candidate_error) end
    local detected_at = paths.now_iso()
    local rom = helpers.get_rom_name()
    local output_dir = paths.get_output_dir()
    local next_sequence = capture_sequence + 1
    local candidate_id = tostring(config.hslRunId) .. "_candidate_" .. string.format("%06d", next_sequence)
    local envelope = {
      version = 1,
      candidateId = candidate_id,
      runId = config.hslRunId,
      rom = rom,
      score = candidate.score,
      detectedAt = detected_at,
      source = "mame_memory",
      mameVersion = config.competitionIntegrity.mameVersion,
      pluginVersion = plugin_version,
      strategy = config.automaticCaptureStrategy,
      metadata = candidate.metadata
    }
    local written, write_error = write_json(output_dir, detected_at, rom, candidate.score, "candidate", envelope)
    if not written then return publication_error(write_error) end
    helpers.print_info("[HSL] Candidate escrito: " .. written.filename)
    helpers.pop_message("HSL: intento detectado; se validará al cerrar MAME.")
    return true
  end

  function writer.write_event(reason)
    if integrity and integrity.enabled then
      return publication_error("la captura manual esta desactivada en Competicion protegida")
    end
    local result = tracker.update(reason or "manual_capture")
    if not result.ok then return publication_error(result.error or "lectura de memoria fallida") end
    local detected_at = paths.now_iso()
    local score = tracker.get_capture_score(result)
    local adapter_event = game.build_event(config, tracker.state, result, plugin_version, detected_at, score, helpers)
    local event, sanitize_error = sanitize_json(adapter_event, 0, { count = 0 })
    if sanitize_error or type(event) ~= "table" then return publication_error(sanitize_error or "adapter sin evento") end
    event.schemaVersion = 1
    event.rom = helpers.get_rom_name()
    event.score = score
    event.detectedAt = detected_at
    event.source = "mame_memory"
    event.mameVersion = helpers.get_mame_version()
    event.pluginVersion = plugin_version
    event.competitionIntegrity = nil
    local written, write_error = write_json(paths.get_output_dir(), detected_at, event.rom, score, "legacy", event)
    if not written then return publication_error(write_error) end
    helpers.print_info("[HSL] Evento legacy escrito: " .. written.filename)
    return true
  end

  writer.sanitize_json = function(value) return sanitize_json(value, 0, { count = 0 }) end
  return writer
end

return M
