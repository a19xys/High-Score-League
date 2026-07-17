const test = require("node:test");
const assert = require("node:assert/strict");
const { executeRemoteRequest } = require("../src/remote-request");

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    const fail = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

test("remote request timeout covers delayed headers", async () => {
  const result = await executeRemoteRequest({
    fetchImpl: async (_url, init) => waitForAbort(init.signal),
    timeoutMs: 10,
    url: "https://hsl.example/api",
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureType, "timeout");
  assert.equal(result.reason, "deadline-exceeded");
});

test("remote request timeout also covers body consumption", async () => {
  const result = await executeRemoteRequest({
    fetchImpl: async (_url, init) => ({
      headers: new Headers(),
      ok: true,
      status: 200,
      text: () => waitForAbort(init.signal),
    }),
    timeoutMs: 10,
    url: "https://hsl.example/api",
  });
  assert.equal(result.failureType, "timeout");
});

test("external abort is distinct from timeout and redirects are rejected", async () => {
  const controller = new AbortController();
  let redirectPolicy = null;
  const pending = executeRemoteRequest({
    fetchImpl: async (_url, init) => {
      redirectPolicy = init.redirect;
      return waitForAbort(init.signal);
    },
    signal: controller.signal,
    timeoutMs: 1000,
    url: "https://hsl.example/api",
  });
  controller.abort("suspend");
  const cancelled = await pending;
  assert.equal(cancelled.failureType, "cancelled");
  assert.equal(cancelled.reason, "suspend");
  assert.equal(redirectPolicy, "error");

  const redirect = await executeRemoteRequest({
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "error");
      throw new TypeError("redirect mode is set to error");
    },
    url: "https://hsl.example/api",
  });
  assert.equal(redirect.failureType, "transport-failure");
  assert.equal(JSON.stringify(redirect).includes("hsl.example"), false);
});

test("an already aborted lifecycle signal prevents a new fetch", async () => {
  const controller = new AbortController();
  controller.abort("shutdown");
  let fetched = false;
  const result = await executeRemoteRequest({
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not run");
    },
    signal: controller.signal,
    url: "https://hsl.example/api",
  });
  assert.equal(fetched, false);
  assert.equal(result.failureType, "cancelled");
  assert.equal(result.reason, "shutdown");
});
