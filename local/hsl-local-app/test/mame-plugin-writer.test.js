const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const writerPath = path.join(__dirname, "..", "..", "mame-plugin", "hsl-score", "core", "writer.lua");

test("Lua writer publishes a closed temporary file by same-directory rename", async () => {
  const source = await fsp.readFile(writerPath, "utf8");
  const open = source.indexOf('io.open(temporary_filename, "w")');
  const encode = source.indexOf("local encoded_event = json.encode(event)");
  const write = source.indexOf('file:write(encoded_event, "\\n")');
  const close = source.indexOf("file:close()", write);
  const rename = source.indexOf("os.rename(temporary_filename, filename)");

  assert.ok(encode >= 0);
  assert.ok(open > encode);
  assert.ok(write > open);
  assert.ok(close > write);
  assert.ok(rename > close);
  assert.doesNotMatch(source, /io\.open\(filename,\s*"w"\)/);
  assert.match(source, /temporary_filename = final_filename \.\. "\.tmp"/);
  assert.match(source, /if file_exists\(filename\) then/);
});

test("Lua writer gives same-second captures a monotonic collision-resistant suffix", async () => {
  const source = await fsp.readFile(writerPath, "utf8");
  assert.match(source, /local capture_sequence = 0/);
  assert.match(source, /capture_sequence = capture_sequence \+ 1/);
  assert.match(source, /%06d\.json/);
  assert.match(source, /not file_exists\(final_filename\) and not file_exists\(temporary_filename\)/);
});

test("Lua writer replaces adapter integrity evidence on a core-owned plain table", async () => {
  const source = await fsp.readFile(writerPath, "utf8");
  const adapterBuild = source.indexOf("local adapter_event = game.build_event");
  const plainTable = source.indexOf("local event = {}", adapterBuild);
  const skipForged = source.indexOf('if key ~= "competitionIntegrity"', plainTable);
  const coreEvidence = source.indexOf("event.competitionIntegrity = integrity and integrity.evidence() or nil", skipForged);

  assert.ok(adapterBuild >= 0);
  assert.ok(plainTable > adapterBuild);
  assert.ok(skipForged > plainTable);
  assert.ok(coreEvidence > skipForged);
});
