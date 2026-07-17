const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifySubmissionHttpResult,
  classifySubmissionRequestFailure,
  parseRetryAfter,
} = require("../src/submission-outcome");

test("canonical submission outcomes cover success, duplicate, auth, terminal and unexpected 4xx", () => {
  assert.equal(classifySubmissionHttpResult({ status: 200, body: { ok: true } }).outcome, "success");
  assert.equal(classifySubmissionHttpResult({ status: 409, body: { duplicate: true } }).outcome, "duplicate");
  const auth = classifySubmissionHttpResult({ status: 401 });
  assert.equal(auth.authRequired, true);
  assert.equal(auth.preservePending, true);
  for (const status of [400, 403, 409]) {
    const result = classifySubmissionHttpResult({ status, body: { ok: false } });
    assert.equal(result.outcome, "terminal-failure");
    assert.equal(result.terminal, true);
    assert.equal(result.preservePending, false);
  }
  const unexpected = classifySubmissionHttpResult({ status: 422 });
  assert.equal(unexpected.outcome, "attention-required");
  assert.equal(unexpected.preservePending, true);
  assert.equal(unexpected.ok, false);
});

test("408, 425, 429 and 5xx remain pending and retryable", () => {
  for (const status of [408, 425, 429, 500, 503, 599]) {
    const result = classifySubmissionHttpResult({ status });
    assert.equal(result.outcome, "retryable-http");
    assert.equal(result.retryable, true);
    assert.equal(result.preservePending, true);
    assert.equal(result.terminal, false);
    assert.equal(result.ok, false);
  }
});

test("Retry-After accepts seconds or dates with 5s-15m bounds and rejects disproportionate values", () => {
  const nowMs = Date.parse("2026-07-17T00:00:00Z");
  assert.equal(parseRetryAfter("1", { nowMs }), 5000);
  assert.equal(parseRetryAfter("60", { nowMs }), 60000);
  assert.equal(parseRetryAfter("Fri, 17 Jul 2026 00:02:00 GMT", { nowMs }), 120000);
  assert.equal(parseRetryAfter("901", { nowMs }), null);
  assert.equal(parseRetryAfter("-1", { nowMs }), null);
  assert.equal(parseRetryAfter("nonsense", { nowMs }), null);
});

test("transport, timeout and cancellation stay distinct and never terminal", () => {
  for (const type of ["transport-failure", "timeout", "cancelled"]) {
    const result = classifySubmissionRequestFailure({ failureType: type });
    assert.equal(result.outcome, type);
    assert.equal(result.preservePending, true);
    assert.equal(result.terminal, false);
  }
});
