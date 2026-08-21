const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findCompetitionReservedMameArgument,
  validatePackMameArguments,
} = require("../src/mame-arguments");
const {
  MAME_0287_BLOCKED_UI_INPUTS,
  buildCompetitionControllerProfile,
} = require("../src/mame-controller-profile");

test("opciones peligrosas se rechazan solo en Competition y con variantes de parser", () => {
  for (const token of ["-rewind", "--state=foo", "/cheat", "-speed:2", "--autoboot_script=x.lua", "-ctrlr", "-bench=10", "-nohttp"]) {
    assert.ok(findCompetitionReservedMameArgument([token]), token);
    assert.throws(() => validatePackMameArguments([token], "mame.launchArgs", { mode: "competition" }), /no permitida en Competicion/);
    assert.deepEqual(validatePackMameArguments([token], "mame.launchArgs", { mode: "practice" }), [token]);
  }
});

test("controller 0.287 neutraliza tipos reales y preserva UI_CANCEL Escape", () => {
  const xml = buildCompetitionControllerProfile();
  assert.match(xml, /<mameconfig version="10">/);
  for (const token of MAME_0287_BLOCKED_UI_INPUTS) {
    assert.match(xml, new RegExp(`<port type="${token}">[\\s\\S]*?<newseq type="standard">NONE<\\/newseq>`));
  }
  assert.match(xml, /<port type="UI_CANCEL">[\s\S]*KEYCODE_ESC/);
  assert.doesNotMatch(xml, /<port type="UI_CANCEL">[\s\S]*NONE/);
});
