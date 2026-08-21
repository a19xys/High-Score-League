const test = require("node:test");
const assert = require("node:assert/strict");
const { healthEndpoint } = require("../src/connectivity-service");
const { OFFICIAL_HSL_ORIGIN } = require("../src/hsl-origin");
const { postPlayTimeEvent } = require("../src/playtime-http");
const { requestLauncherPresence } = require("../src/presence-http");
const { rankingCapabilitiesEndpoint } = require("../src/ranking-capabilities-service");
const { packDescriptorEndpoint } = require("../src/remote-pack-import");
const { getMembershipUrl } = require("../src/season-membership");
const { getIngestUrl, postSubmission } = require("../src/submission-http");
const { weekCapabilitiesEndpoint } = require("../src/week-capabilities-service");

test("official launcher API endpoint builders derive every HSL request from the apex", () => {
  assert.equal(healthEndpoint(OFFICIAL_HSL_ORIGIN), "https://highscoreleague.com/api/launcher/health");
  assert.equal(rankingCapabilitiesEndpoint(OFFICIAL_HSL_ORIGIN), "https://highscoreleague.com/api/launcher/ranking-capabilities");
  assert.equal(weekCapabilitiesEndpoint(OFFICIAL_HSL_ORIGIN), "https://highscoreleague.com/api/launcher/week-capabilities");
  assert.equal(
    getMembershipUrl({ webBaseUrl: OFFICIAL_HSL_ORIGIN }, "week 1"),
    "https://highscoreleague.com/api/local/season-membership?weekId=week%201",
  );
  assert.equal(getIngestUrl({ webBaseUrl: OFFICIAL_HSL_ORIGIN }), "https://highscoreleague.com/api/submissions/ingest");
  assert.equal(
    packDescriptorEndpoint(OFFICIAL_HSL_ORIGIN, "space-invaders-s1-w1-r1").toString(),
    "https://highscoreleague.com/api/launcher/packs/space-invaders-s1-w1-r1/download",
  );
});

test("Submission, Playtime and Presence adapters send to the resolved apex", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ method: init.method, url: String(url) });
    return new Response(JSON.stringify({ duplicate: false, ok: true }), { status: 201 });
  };

  await postSubmission({ webBaseUrl: OFFICIAL_HSL_ORIGIN }, "submission-token", { event: "score" }, { fetchImpl });
  await postPlayTimeEvent({
    accessToken: "playtime-token",
    event: { eventId: "event-1" },
    fetchImpl,
    webBaseUrl: OFFICIAL_HSL_ORIGIN,
  });
  await requestLauncherPresence({
    accessToken: "presence-token",
    fetchImpl,
    method: "POST",
    payload: { version: 1 },
    webBaseUrl: OFFICIAL_HSL_ORIGIN,
  });

  assert.deepEqual(requests, [
    { method: "POST", url: "https://highscoreleague.com/api/submissions/ingest" },
    { method: "POST", url: "https://highscoreleague.com/api/launcher/playtime/ingest" },
    { method: "POST", url: "https://highscoreleague.com/api/launcher/presence" },
  ]);
});
