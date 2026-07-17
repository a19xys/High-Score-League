const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OFFICIAL_HSL_ORIGIN,
  normalizeHslOrigin,
  resolveHslOrigin,
} = require("../src/hsl-origin");

test("HSL origins are absolute, credential-free HTTP origins", () => {
  assert.equal(normalizeHslOrigin("https://hsl.example/path"), "https://hsl.example");
  assert.equal(normalizeHslOrigin("http://localhost:3000/"), "http://localhost:3000");
  assert.equal(normalizeHslOrigin("hsl.example"), null);
  assert.equal(normalizeHslOrigin("file:///hsl"), null);
  assert.equal(normalizeHslOrigin("https://user:secret@hsl.example"), null);
  assert.equal(normalizeHslOrigin("https://hsl.example?environment=dev"), null);
  assert.equal(normalizeHslOrigin("https://hsl.example#health"), null);
});

test("official builds resolve the compiled origin without local config", () => {
  assert.deepEqual(resolveHslOrigin(), {
    hslOrigin: OFFICIAL_HSL_ORIGIN,
    message: "Origen HSL configurado.",
    source: "official-default",
    status: "configured",
  });
});

test("environment, launcher config and legacy alias use explicit precedence", () => {
  assert.equal(resolveHslOrigin({
    configuredOrigin: "https://config.example",
    environmentOrigin: "http://localhost:3000/path",
    legacyWebBaseUrl: "https://legacy.example",
  }).hslOrigin, "http://localhost:3000");
  assert.equal(resolveHslOrigin({ configuredOrigin: "https://config.example" }).source, "launcher-config");
  const legacy = resolveHslOrigin({ legacyWebBaseUrl: "https://legacy.example/path" });
  assert.equal(legacy.hslOrigin, "https://legacy.example");
  assert.equal(legacy.source, "legacy-webBaseUrl");
});

test("invalid explicit configuration is reported instead of hidden by a fallback", () => {
  const invalid = resolveHslOrigin({
    configuredOrigin: "https://user:secret@hsl.example",
  });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.source, "launcher-config");
  assert.equal(invalid.hslOrigin, null);

  const missing = resolveHslOrigin({ officialOrigin: null });
  assert.equal(missing.status, "missing");
  assert.equal(missing.source, "none");
});
