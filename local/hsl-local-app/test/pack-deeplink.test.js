const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPackDeepLinkAdditionalData,
  parsePackDeepLink,
  parsePackDeepLinkAdditionalData,
  parsePackDeepLinkArgv,
} = require("../src/pack-deeplink");

test("parser acepta únicamente el contrato canónico import-pack", () => {
  assert.deepEqual(parsePackDeepLink("highscoreleague://import-pack/foo"), {
    packId: "foo",
    type: "import-pack",
    version: 1,
  });
  assert.equal(parsePackDeepLink("highscoreleague://import-pack/space-invaders-week-1").packId, "space-invaders-week-1");
  assert.equal(parsePackDeepLink("highscoreleague://import-pack/space_invaders_v2").packId, "space_invaders_v2");
});

test("parser rechaza cualquier capacidad o estructura fuera del packId", () => {
  const invalid = [
    "https://import-pack/foo",
    "highscoreleague://other/foo",
    "highscoreleague://import-pack",
    "highscoreleague://import-pack/",
    "highscoreleague://import-pack/foo/bar",
    "highscoreleague://import-pack/foo?bar=1",
    "highscoreleague://import-pack/foo?",
    "highscoreleague://import-pack/foo#bar",
    "highscoreleague://import-pack/foo#",
    "highscoreleague://user@import-pack/foo",
    "highscoreleague://user:secret@import-pack/foo",
    "highscoreleague://import-pack:443/foo",
    "highscoreleague://import-pack/Foo",
    "highscoreleague://import-pack/../foo",
    "highscoreleague://import-pack/%2e%2e",
    "highscoreleague://import-pack/%2fetc",
    "highscoreleague://import-pack/foo%2fbar",
    "highscoreleague://import-pack/C:%5cfoo",
    `highscoreleague://import-pack/${"a".repeat(129)}`,
    "highscoreleague://import-pack/foo.bar",
    "highscoreleague://import-pack/foo%20bar",
  ];
  for (const value of invalid) assert.equal(parsePackDeepLink(value), null, value);
});

test("argv encuentra un candidato en cualquier posición y falla cerrado si es ambiguo", () => {
  assert.equal(parsePackDeepLinkArgv(["launcher.exe", "--flag", "highscoreleague://import-pack/foo", "--after"]).intent.packId, "foo");
  assert.deepEqual(parsePackDeepLinkArgv(["launcher.exe", "--flag"]), { intent: null, status: "none" });
  assert.deepEqual(parsePackDeepLinkArgv(["launcher.exe", "highscoreleague://import-pack/Foo"]), { intent: null, status: "invalid" });
  assert.deepEqual(parsePackDeepLinkArgv([
    "highscoreleague://import-pack/foo",
    "--flag",
    "highscoreleague://import-pack/bar",
  ]), { intent: null, status: "ambiguous" });
});

test("additionalData sólo acepta la forma normalizada exacta", () => {
  const intent = parsePackDeepLink("highscoreleague://import-pack/foo");
  assert.deepEqual(createPackDeepLinkAdditionalData(intent), { packDeepLink: intent });
  assert.deepEqual(parsePackDeepLinkAdditionalData({ packDeepLink: intent }), intent);
  for (const value of [
    null,
    {},
    { packDeepLink: { ...intent, rawUrl: "highscoreleague://import-pack/foo" } },
    { packDeepLink: { ...intent, version: 2 } },
    { packDeepLink: { ...intent, packId: "Foo" } },
    { packDeepLink: "foo" },
  ]) assert.equal(parsePackDeepLinkAdditionalData(value), null);
});
