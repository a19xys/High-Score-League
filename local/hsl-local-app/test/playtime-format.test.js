const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPlayTime } = require("../src/playtime-format");

test("Playtime formatter follows the exact minute/hour boundary", () => {
  const cases = new Map([
    [0, "No jugado"],
    [1, "1 s"],
    [30, "30 s"],
    [59, "59 s"],
    [60, "1 min"],
    [119, "1 min"],
    [7140, "119 min"],
    [7199, "119 min"],
    [7200, "2,0 h"],
    [7260, "2,0 h"],
    [13680, "3,8 h"],
    [25200, "7,0 h"],
  ]);
  for (const [seconds, expected] of cases) assert.equal(formatPlayTime(seconds), expected);
  assert.doesNotMatch(Array.from(cases.values()).join(" "), /horas/);
});
