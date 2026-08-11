const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifySubmissionHttpResult,
  classifySubmissionRequestFailure,
  parseRetryAfter,
} = require("../src/submission-outcome");

test("canonical submission outcomes use domain codes instead of status alone", () => {
  assert.equal(classifySubmissionHttpResult({ status: 200, body: { ok: true } }).outcome, "success");
  assert.equal(classifySubmissionHttpResult({ status: 409, body: { duplicate: true } }).outcome, "duplicate");
  const auth = classifySubmissionHttpResult({ status: 401 });
  assert.equal(auth.authRequired, true);
  assert.equal(auth.preservePending, true);

  for (const code of [
    "WEEK_NOT_FOUND",
    "WEEK_GAME_NOT_ASSIGNED",
    "NOT_SEASON_MEMBER",
    "WEEK_WINDOW_UNAVAILABLE",
    "WEEK_NOT_OPEN_AT_DETECTION",
    "WEEK_CLOSED_AT_DETECTION",
    "DETECTED_AT_IN_FUTURE",
  ]) {
    const result = classifySubmissionHttpResult({ status: 409, body: { code, ok: false } });
    assert.equal(result.outcome, "rejected-domain", code);
    assert.equal(result.terminal, true);
    assert.equal(result.preservePending, false);
  }

  for (const code of ["DUPLICATE_KEY_CONFLICT", "SUBMISSION_POLICY_REJECTED"]) {
    const result = classifySubmissionHttpResult({ status: 409, body: { code, ok: false } });
    assert.equal(result.outcome, "attention-required", code);
    assert.equal(result.preservePending, false);
  }

  for (const status of [403, 404, 409]) {
    const result = classifySubmissionHttpResult({ status, body: { ok: false } });
    assert.equal(result.outcome, "ambiguous-http", status);
    assert.equal(result.preservePending, true);
    assert.equal(result.retryable, true);
  }

  const unexpected = classifySubmissionHttpResult({ status: 422 });
  assert.equal(unexpected.outcome, "attention-required");
  assert.equal(unexpected.preservePending, false);
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
