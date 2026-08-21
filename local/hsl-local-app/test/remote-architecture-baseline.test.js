const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyRequest,
  createRequestRecorder,
  measureFocus,
  measureIdleOnline,
  measureReconnect,
  measureResume,
  measureUnavailable,
  sanitizedUrl,
} = require("./support/remote-architecture-baseline-harness");

function assertMeasurementCoherent(measurement) {
  assert.ok(measurement.label);
  assert.ok(measurement.local.timerCallbacks >= 0);
  assert.ok(measurement.local.topologyInspections >= 0);
  assert.ok(measurement.logical.connectivityEmissions >= 0);
  assert.deepEqual(
    Object.values(measurement.remote).reduce((sum, value) => sum + value, 0),
    measurement.requests.length,
  );
  assert.equal(measurement.requests.every((request) => (
    typeof request.category === "string"
      && ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)
      && !/[\r\n]/u.test(request.url)
  )), true);
}

test("request inventory classifies endpoints and stores only sanitized metadata", () => {
  const recorder = createRequestRecorder();
  recorder.record("https://user:password@hsl.test/api/local/season-membership?weekId=week-a&token=secret", {
    headers: { Authorization: "Bearer secret-token", apikey: "secret-key" },
  });
  recorder.record("https://fixture.supabase.co/auth/v1/token?grant_type=refresh_token", {
    body: JSON.stringify({ email: "player@example.test", refresh_token: "secret-refresh" }),
    method: "POST",
  });
  const serialized = JSON.stringify(recorder.list());
  assert.equal(classifyRequest("https://hsl.test/api/launcher/health"), "health");
  assert.equal(classifyRequest("https://hsl.test/api/launcher/week-capabilities"), "week-capabilities");
  assert.equal(classifyRequest("https://hsl.test/api/launcher/ranking-capabilities"), "ranking-capabilities");
  assert.equal(classifyRequest("https://hsl.test/api/launcher/presence"), "presence");
  assert.equal(classifyRequest("https://hsl.test/api/launcher/playtime/ingest"), "playtime");
  assert.equal(classifyRequest("https://hsl.test/api/submissions/ingest"), "submission");
  assert.equal(classifyRequest("https://fixture.supabase.co/rest/v1/profiles"), "profile");
  assert.equal(classifyRequest("https://fixture.supabase.co/storage/v1/object/public/avatar.webp"), "avatar");
  assert.equal(classifyRequest("https://fixture.supabase.co/auth/v1/token"), "auth");
  assert.equal(sanitizedUrl("https://user:password@hsl.test/path?token=secret"), "https://hsl.test/path?token=%5Bredacted%5D");
  for (const secret of ["password", "secret-token", "secret-key", "secret-refresh", "player@example.test", "week-a"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("deterministic idle windows finish, drain in-flight work and distinguish triggers from HTTP", async (t) => {
  for (const activity of ["active", "background"]) {
    await t.test(activity, async () => {
      const result = await measureIdleOnline(activity);
      assertMeasurementCoherent(result.startup);
      assertMeasurementCoherent(result.idle);
      assert.equal(result.startup.remote.health > 0, true);
      assert.equal(result.idle.remote.health > 0, true);
      assert.equal(result.idle.local.topologyInspections > 0, true);
      assert.equal(result.idle.logical.playtimeRequest > 0, true);
      assert.equal(result.idle.remote.playtime, 0);
      assert.equal(result.idle.logical.weekRefresh > result.idle.remote["week-capabilities"], true);
      assert.equal(result.idle.state.connectivity.probe.inFlight, false);
      assert.equal(result.idle.state.profile.inFlight, false);
      assert.equal(result.idle.state.week.inFlight, false);
      assert.equal(result.timersAfterStop, 0);
    });
  }
});

test("system-offline and HSL-unreachable are separate deterministic recovery baselines", async () => {
  const systemOffline = await measureUnavailable({ hslReachable: true, systemOnline: false });
  const hslUnreachable = await measureUnavailable({ hslReachable: false, systemOnline: true });
  assertMeasurementCoherent(systemOffline.measurement);
  assertMeasurementCoherent(hslUnreachable.measurement);
  assert.equal(systemOffline.measurement.remote.health, 0);
  assert.equal(systemOffline.measurement.local.netIsOnlineInspections > 0, true);
  assert.equal(hslUnreachable.measurement.remote.health > 0, true);
  assert.equal(systemOffline.measurement.remote.membership, 0);
  assert.equal(hslUnreachable.measurement.remote.membership, 0);
  assert.equal(systemOffline.timersAfterStop, 0);
  assert.equal(hslUnreachable.timersAfterStop, 0);
});

test("reconnect, focus and resume scenarios record all remote calls and clean timers", async () => {
  const reconnect = await measureReconnect();
  const focus = await measureFocus();
  const resume = await measureResume();
  assertMeasurementCoherent(reconnect.measurement);
  assertMeasurementCoherent(focus.fresh);
  assertMeasurementCoherent(focus.stale);
  assertMeasurementCoherent(resume.measurement);
  assert.equal(reconnect.measurement.remote.health > 0, true);
  assert.equal(reconnect.measurement.logical.autoSubmitRequest > 0, true);
  assert.equal(focus.fresh.remote.health, 0);
  assert.equal(focus.stale.remote.health > 0, true);
  assert.equal(resume.measurement.remote.health > 0, true);
  assert.equal(reconnect.timersAfterStop, 0);
  assert.equal(focus.timersAfterStop, 0);
  assert.equal(resume.timersAfterStop, 0);
});
