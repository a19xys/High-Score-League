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
  for (const token of [
    "-rewind", "--state=foo", "/cheat", "-speed:2", "--autoboot_script=x.lua",
    "-ctrlr", "-bench=10", "-nohttp", "-script", "-pb",
    "-unknown",
  ]) {
    assert.throws(() => validatePackMameArguments([token], "mame.launchArgs", { mode: "competition" }), /no permitida en Competicion/);
    assert.deepEqual(validatePackMameArguments([token], "mame.launchArgs", { mode: "practice" }), [token]);
  }
  for (const token of ["--plugin=x", "/plugins", "-ctrlr_path"]) {
    assert.throws(() => validatePackMameArguments([token], "mame.launchArgs", { mode: "competition" }), /reservada|no permitida/);
  }
});

test("visual aliases normalize through the same Competition parser", () => {
  for (const [args, expected] of [
    [["--video=bgfx", "/bgfx_screen_chains:crt-geom"], ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"]],
    [["/video", "bgfx", "--bgfx-screen-chains", "crt-geom"], ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"]],
    [["-video:bgfx", "-bgfx_screen_chains=crt-geom"], ["-video", "bgfx", "-bgfx_screen_chains", "crt-geom"]],
  ]) {
    assert.deepEqual(validatePackMameArguments(args, "mame.launchArgs", { mode: "competition" }), expected);
    assert.deepEqual(validatePackMameArguments(args, "mame.launchArgs", { mode: "practice" }), expected);
  }
});

test("Competition allowlist has exact tokens, arities and visual values", () => {
  assert.deepEqual(validatePackMameArguments([
    "-video", "bgfx", "-bgfx_screen_chains", "crt-geom",
  ], "mame.launchArgs", { mode: "competition" }), [
    "-video", "bgfx", "-bgfx_screen_chains", "crt-geom",
  ]);
  for (const args of [
    ["-video"], ["-video", "none"], ["-video", "bgfx", "extra"],
    ["-bgfx_screen_chains"], ["-bgfx_screen_chains", "../unsafe"],
    ["-video", "bgfx", "-video", "bgfx"], ["video", "bgfx"], ["-"], ["--"],
  ]) {
    assert.throws(() => validatePackMameArguments(args, "mame.launchArgs", { mode: "competition" }));
  }
});

test("Competition allowlist closes every audited dangerous option and alias", () => {
  for (const token of [
    "-script", "-autoboot_script", "-pb", "-playback", "-rec", "-record",
    "-c", "-cheat", "-rs", "-refreshspeed", "-state", "-rewind", "-debug",
    "-console", "-http", "-plugin", "-plugins", "-ctrlr", "-ctrlrpath", "-bench",
  ]) {
    assert.throws(
      () => validatePackMameArguments([token], "mame.launchArgs", { mode: "competition" }),
      /reservada|no permitida/,
      token,
    );
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
