const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPlayTime } = require("../src/playtime-format");

test("Playtime formatter follows the exact minute/hour boundary", () => {
  const cases = new Map([
    [0, "0 min"],
    [30, "0 min"],
    [60, "1 min"],
    [480, "8 min"],
    [6600, "110 min"],
    [7199, "119 min"],
    [7200, "2,0 h"],
    [12240, "3,4 h"],
    [46080, "12,8 h"],
  ]);
  for (const [seconds, expected] of cases) assert.equal(formatPlayTime(seconds), expected);
});
