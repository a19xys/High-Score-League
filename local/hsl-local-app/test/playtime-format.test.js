const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPlayTime } = require("../src/playtime-format");

test("Playtime formatter follows the exact minute/hour boundary", () => {
  const cases = new Map([
    [0, "0 minutos"],
    [30, "Menos de 1 minuto"],
    [60, "1 minuto"],
    [480, "8 minutos"],
    [6600, "110 minutos"],
    [7199, "119 minutos"],
    [7200, "2,0 horas"],
    [12240, "3,4 horas"],
    [46080, "12,8 horas"],
  ]);
  for (const [seconds, expected] of cases) assert.equal(formatPlayTime(seconds), expected);
});
