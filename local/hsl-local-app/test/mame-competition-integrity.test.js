const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const pluginRoot = path.join(__dirname, "..", "..", "mame-plugin", "hsl-score");

test("hsl-score 0.4.0 wires durable integrity before automatic frame capture", async () => {
  const [init, metadata, monitor] = await Promise.all([
    fsp.readFile(path.join(pluginRoot, "init.lua"), "utf8"),
    fsp.readFile(path.join(pluginRoot, "plugin.json"), "utf8"),
    fsp.readFile(path.join(pluginRoot, "core", "competition_integrity.lua"), "utf8"),
  ]);
  assert.equal(JSON.parse(metadata).plugin.version, "0.4.0");
  assert.match(init, /version = "0\.4\.0"/);
  assert.match(init, /PLUGIN_VERSION = "0\.4\.0"/);
  const start = init.indexOf("integrity.start()");
  const prestart = init.indexOf("emu.register_prestart", start);
  const prepare = init.indexOf("integrity.prepare()", prestart);
  const frame = init.indexOf("integrity.frame_tick()", prepare);
  assert.ok(start >= 0 && prestart > start && prepare > prestart && frame > prepare);
  assert.match(monitor, /state = "prepared"/);
  assert.match(monitor, /state = next\(violations\) == nil and "armed" or "violated"/);
  assert.match(monitor, /armed\.marker/);
  assert.match(monitor, /final\.marker/);
  assert.match(monitor, /violation\." \.\. code \.\. "\.marker"/);
  assert.match(monitor, /exit_pending == true/);
  assert.doesNotMatch(monitor, /violate_for_test|qaAction|testButton/i);
});

test("automatic core is game-agnostic and accepts a fake observe_capture-only adapter", async () => {
  const tracking = await fsp.readFile(path.join(pluginRoot, "core", "tracking.lua"), "utf8");
  const init = await fsp.readFile(path.join(pluginRoot, "init.lua"), "utf8");
  const fake = await fsp.readFile(path.join(__dirname, "fixtures", "mame-adapters", "fake-automatic.lua"), "utf8");
  assert.match(fake, /function M\.observe_capture/);
  assert.doesNotMatch(fake, /read_memory|build_event/);
  assert.match(init, /Competicion protegida requiere observe_capture/);
  assert.doesNotMatch(tracking, /20F8|20F9|20EF|20E7|21FF|BCD|rollover|invaders/i);
  assert.match(tracking, /trackingIntervalFrames/);
  assert.match(tracking, /game\.observe_capture, helpers/);
});

test("integrity monitor retains every notifier and declares sticky codes canonically", async () => {
  const monitor = await fsp.readFile(path.join(pluginRoot, "core", "competition_integrity.lua"), "utf8");
  for (const [name, notifier] of [
    ["pause", "add_machine_pause_notifier"],
    ["pre_save", "add_machine_pre_save_notifier"],
    ["post_load", "add_machine_post_load_notifier"],
    ["reset", "add_machine_reset_notifier"],
    ["stop", "add_machine_stop_notifier"],
  ]) {
    assert.match(monitor, new RegExp(`subscriptions\\.${name} = emu_api\\.${notifier}`));
  }
  const codes = [
    "dip_changed", "pause", "state_save", "state_load", "machine_reset",
    "menu_opened", "speed_changed", "throttle_changed", "run_input_changed", "integrity_unavailable",
  ];
  let previous = -1;
  for (const code of codes) {
    const index = monitor.indexOf(`"${code}"`);
    assert.ok(index > previous, code);
    previous = index;
  }
  assert.match(monitor, /if not violations\[code\] then/);
});
