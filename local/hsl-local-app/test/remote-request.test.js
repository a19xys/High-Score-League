const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
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

test("remote request deadline keeps an isolated pending operation alive", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "hsl-remote-request-deadline-"));
  const markerPath = path.join(directory, "result.json");
  const modulePath = path.resolve(__dirname, "..", "src", "remote-request.js");
  const script = [
    `const fs = require("node:fs");`,
    `const { executeRemoteRequest } = require(${JSON.stringify(modulePath)});`,
    `const waitForAbort = (signal) => new Promise((_, reject) => {`,
    `  const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));`,
    `  if (signal.aborted) fail(); else signal.addEventListener("abort", fail, { once: true });`,
    `});`,
    `executeRemoteRequest({`,
    `  fetchImpl: async (_url, init) => waitForAbort(init.signal),`,
    `  timeoutMs: 20,`,
    `  url: "https://hsl.example/api",`,
    `}).then((result) => fs.writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify(result)));`,
  ].join("\n");

  try {
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Child exit ${code}.`)));
    });
    const result = JSON.parse(await fsp.readFile(markerPath, "utf8"));
    assert.equal(result.failureType, "timeout");
    assert.equal(result.reason, "deadline-exceeded");
  } finally {
    await fsp.rm(directory, { force: true, recursive: true });
  }
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

test("binary responses are streamed with a hard size limit", async () => {
  const accepted = await executeRemoteRequest({
    fetchImpl: async () => new Response(Buffer.from([1, 2, 3])),
    maxResponseBytes: 3,
    responseType: "arrayBuffer",
    url: "https://hsl.example/avatar",
  });
  assert.deepEqual([...accepted.bodyBuffer], [1, 2, 3]);

  const rejected = await executeRemoteRequest({
    fetchImpl: async () => new Response(Buffer.from([1, 2, 3, 4])),
    maxResponseBytes: 3,
    responseType: "arrayBuffer",
    url: "https://hsl.example/avatar",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.technicalReason, "Error:RESPONSE_TOO_LARGE");
});
