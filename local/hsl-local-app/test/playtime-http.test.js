const test = require("node:test");
const assert = require("node:assert/strict");
const { postPlayTimeEvent } = require("../src/playtime-http");

test("HTTP adapter treats NEW and DUPLICATE as success", async () => {
  for (const [status, duplicate] of [[201, false], [200, true]]) {
    let request;
    const result = await postPlayTimeEvent({
      accessToken: "secret-token",
      event: { eventId: "event" },
      fetchImpl: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ ok: true, duplicate }), { status });
      },
      webBaseUrl: "https://hsl.test/",
    });
    assert.equal(result.ok, true);
    assert.equal(result.duplicate, duplicate);
    assert.equal(request.url, "https://hsl.test/api/launcher/playtime/ingest");
    assert.equal(request.init.headers.Authorization, "Bearer secret-token");
  }
});

test("HTTP adapter classifies retryable and terminal responses", async () => {
  const throttled = await postPlayTimeEvent({
    accessToken: "token",
    event: {},
    fetchImpl: async () => new Response("{}", { status: 429, headers: { "retry-after": "3" } }),
    webBaseUrl: "https://hsl.test",
  });
  assert.equal(throttled.terminal, false);
  assert.equal(throttled.failureType, "throttled");
  assert.equal(throttled.retryAfterMs, 3000);

  const terminal = await postPlayTimeEvent({
    accessToken: "token",
    event: {},
    fetchImpl: async () => new Response("{}", { status: 400 }),
    webBaseUrl: "https://hsl.test",
  });
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.failureType, "domain");
});
