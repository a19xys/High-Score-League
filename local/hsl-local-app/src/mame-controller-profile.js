const MAME_CONTROLLER_CONFIG_VERSION = 10;
const COMPETITION_CONTROLLER_NAME = "hsl-competition";

const MAME_0287_BLOCKED_UI_INPUTS = Object.freeze([
  "UI_MENU",
  "UI_PAUSE",
  "UI_PAUSE_SINGLE",
  "UI_REWIND_SINGLE",
  "UI_SAVE_STATE",
  "UI_SAVE_STATE_QUICK",
  "UI_LOAD_STATE",
  "UI_LOAD_STATE_QUICK",
  "UI_RESET_MACHINE",
  "UI_SOFT_RESET",
  "UI_THROTTLE",
  "UI_FAST_FORWARD",
  "UI_TOGGLE_CHEAT",
]);

function buildCompetitionControllerProfile() {
  const ports = MAME_0287_BLOCKED_UI_INPUTS.map((token) => [
    `      <port type="${token}">`,
    '        <newseq type="standard">NONE</newseq>',
    "      </port>",
  ].join("\n"));

  ports.push([
    '      <port type="UI_CANCEL">',
    '        <newseq type="standard">KEYCODE_ESC</newseq>',
    "      </port>",
  ].join("\n"));

  return [
    '<?xml version="1.0"?>',
    `<mameconfig version="${MAME_CONTROLLER_CONFIG_VERSION}">`,
    '  <system name="default">',
    "    <input>",
    ...ports,
    "    </input>",
    "  </system>",
    "</mameconfig>",
    "",
  ].join("\n");
}

module.exports = {
  COMPETITION_CONTROLLER_NAME,
  MAME_0287_BLOCKED_UI_INPUTS,
  MAME_CONTROLLER_CONFIG_VERSION,
  buildCompetitionControllerProfile,
};
