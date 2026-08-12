const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPlayTime } = require("../src/playtime-format");

test("Playtime formatter follows the exact minute/hour boundary", () => {
  const cases = new Map([
    [0, "No jugado"],
    [1, "0 min"],
    [30, "0 min"],
    [59, "0 min"],
    [60, "1 min"],
    [7140, "119 min"],
    [7199, "119 min"],
    [7200, "2,0 horas"],
    [7260, "2,0 horas"],
    [13680, "3,8 horas"],
    [25200, "7,0 horas"],
  ]);
  for (const [seconds, expected] of cases) assert.equal(formatPlayTime(seconds), expected);
});
