const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const writerPath = path.join(__dirname, "..", "..", "mame-plugin", "hsl-score", "core", "writer.lua");

test("Lua writer publishes a closed temporary file by same-directory rename", async () => {
  const source = await fsp.readFile(writerPath, "utf8");
  const open = source.indexOf('io.open(temporary, "w")');
  const encode = source.indexOf("json.encode(value)");
  const write = source.indexOf('file:write(json.encode(value), "\\n")');
  const close = source.indexOf("file:close()", write);
  const rename = source.indexOf("os.rename(temporary, filename)");

  assert.ok(encode >= 0);
  assert.ok(open >= 0);
  assert.ok(encode > open);
  assert.ok(write > open);
  assert.ok(close > write);
  assert.ok(rename > close);
  assert.doesNotMatch(source, /io\.open\(filename,\s*"w"\)/);
  assert.match(source, /local temporary = filename \.\. "\.tmp"/);
  assert.match(source, /if file_exists\(filename\) then/);
});

test("Lua writer gives same-second captures a monotonic collision-resistant suffix", async () => {
  const source = await fsp.readFile(writerPath, "utf8");
  assert.match(source, /local capture_sequence = integrity and integrity\.candidate_count and integrity\.candidate_count\(\) or 0/);
  assert.match(source, /local sequence = capture_sequence \+ 1/);
  assert.match(source, /capture_sequence = sequence/);
  assert.match(source, /%s_%s_%s_%s_%06d/);
  assert.match(source, /basename \.\. "\.json"/);
  assert.match(source, /not file_exists\(filename\) and not file_exists\(temporary\)/);
});

test("Lua writer accepts only sanitized score metadata and builds the candidate envelope in core", async () => {
  const source = await fsp.readFile(writerPath, "utf8");
  assert.match(source, /if key ~= "score" and key ~= "metadata"/);
  assert.match(source, /getmetatable\(request\) ~= nil/);
  assert.match(source, /sanitize_json\(rawget\(request, "metadata"\)/);
  assert.match(source, /candidateId = candidate_id/);
  assert.match(source, /runId = config\.hslRunId/);
  assert.match(source, /mameVersion = config\.competitionIntegrity\.mameVersion/);
  assert.match(source, /function writer\.write_event/);
  assert.match(source, /captura manual esta desactivada en Competicion protegida/);
});
