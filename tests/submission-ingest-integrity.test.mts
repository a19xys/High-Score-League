import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSubmissionIngest,
  type ExistingSubmission,
  type SubmissionIngestDependencies,
  type SubmissionInsertRow,
} from "../lib/api/submission-ingest.ts";
import {
  CANDIDATE_ID,
  competitionPackRow,
  competitionPolicyRow,
  DETECTED_AT,
  DUPLICATE_KEY,
  MANIFEST_SHA256,
  PACK_ID,
  protectedPayload,
  RUN_ID,
  SEASON_ID,
  USER_ID,
  WEEK_ID,
} from "./fixtures/competition-integrity-v2.mts";

function weekRow() {
  return {
    id: WEEK_ID,
    season_id: SEASON_ID,
    game_id: "44444444-4444-4444-8444-444444444444",
    week_number: 1,
    status: "closed" as const,
    public_start_at: "2026-08-21T09:00:00.000Z",
    public_freeze_at: "2026-08-21T10:30:00.000Z",
    final_deadline_at: "2026-08-21T11:00:00.000Z",
    reveal_at: "2026-08-21T12:00:00.000Z",
    rules_summary: null,
  };
}

function existingProtected(overrides: Partial<ExistingSubmission> = {}): ExistingSubmission {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    week_id: WEEK_ID,
    player_id: USER_ID,
    score: 1230,
    source: "mame_memory",
    detected_at: DETECTED_AT,
    submitted_at: "2026-08-22T12:00:00.000Z",
    rom_name: "invaders",
    mame_version: "0.287",
    duplicate_key: DUPLICATE_KEY,
    launcher_pack_id: PACK_ID,
    competition_integrity_version: 2,
    competition_manifest_sha256: MANIFEST_SHA256,
    competition_run_id: RUN_ID,
    competition_candidate_id: CANDIDATE_ID,
    ...overrides,
  };
}

function fixture(overrides: Partial<SubmissionIngestDependencies> = {}) {
  const calls: string[] = [];
  const inserted: SubmissionInsertRow[] = [];
  let duplicate: ExistingSubmission | null = null;
  const dependencies: SubmissionIngestDependencies = {
    authenticate: async () => { calls.push("auth"); return { userId: USER_ID }; },
    checkActiveProfile: async () => { calls.push("profile"); return { active: true, error: null }; },
    createAdminClient: () => { calls.push("admin"); return { role: "service" }; },
    loadWeek: async () => { calls.push("week"); return { data: weekRow(), error: null }; },
    loadPolicy: async () => { calls.push("policy"); return { data: competitionPolicyRow(), error: null }; },
    loadPack: async () => { calls.push("pack"); return { data: competitionPackRow(), error: null }; },
    findDuplicate: async () => { calls.push("duplicate"); return { data: duplicate, error: null }; },
    loadMembership: async () => { calls.push("membership"); return { data: { id: "membership" }, error: null }; },
    insertSubmission: async (_client, row) => {
      calls.push("insert");
      inserted.push(row);
      return {
        data: {
          id: "66666666-6666-4666-8666-666666666666",
          ...row,
          submitted_at: "2026-08-24T12:00:00.000Z",
        },
        error: null,
      };
    },
    now: () => new Date("2026-08-24T12:00:00.000Z"),
    ...overrides,
  };
  return {
    calls,
    inserted,
    dependencies,
    setDuplicate(value: ExistingSubmission | null) { duplicate = value; },
  };
}

test("Protected ingest validates authority before duplicate, membership, window and service insert", async () => {
  const state = fixture();
  const response = await resolveSubmissionIngest(protectedPayload(), state.dependencies);
  assert.equal(response.status, 201, JSON.stringify(response));
  assert.deepEqual(state.calls, ["auth", "profile", "admin", "week", "policy", "pack", "duplicate", "membership", "insert"]);
  assert.equal(state.inserted.length, 1);
  assert.deepEqual(state.inserted[0], {
    week_id: WEEK_ID,
    player_id: USER_ID,
    score: 1230,
    source: "mame_memory",
    detected_at: DETECTED_AT,
    rom_name: "invaders",
    mame_version: "0.287",
    client_version: "0.4.0",
    raw_event: protectedPayload().rawEvent,
    duplicate_key: DUPLICATE_KEY,
    comment: "Fixture WEB independiente",
    is_hidden: false,
    is_valid: true,
    launcher_pack_id: PACK_ID,
    competition_integrity_version: 2,
    competition_manifest_sha256: MANIFEST_SHA256,
    competition_run_id: RUN_ID,
    competition_candidate_id: CANDIDATE_ID,
  });
  assert.equal("submitted_at" in state.inserted[0], false);
});

test("playerId and submittedAt are rejected before Auth and cannot become canonical", async () => {
  for (const injected of [{ playerId: "attacker" }, { submittedAt: "2020-01-01T00:00:00Z" }]) {
    const state = fixture();
    const response = await resolveSubmissionIngest({ ...protectedPayload(), ...injected }, state.dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(state.calls, []);
    assert.equal(state.inserted.length, 0);
  }
});

test("Protected downgrade and canonical mismatches are terminal with zero duplicate lookup or insert", async () => {
  const attacks: Array<[string, (payload: ReturnType<typeof protectedPayload>) => void]> = [
    ["missing", (payload) => { delete (payload.rawEvent.localEvent as any).competitionIntegrity; }],
    ["v1", (payload) => { (payload.rawEvent.localEvent as any).competitionIntegrity = { version: 1 }; }],
    ["developer", (payload) => { payload.rawEvent.localEvent.competitionIntegrity.provenance.mode = "developer_override"; }],
    ["player", (payload) => { payload.rawEvent.localEvent.competitionIntegrity.playerBinding = "d".repeat(64); }],
    ["r1", (payload) => { payload.rawEvent.localEvent.packId = "fixture-pack-r1"; payload.rawEvent.localEvent.competitionIntegrity.packId = "fixture-pack-r1"; }],
    ["manifest", (payload) => { payload.rawEvent.localEvent.competitionIntegrity.manifestSha256 = "d".repeat(64); payload.rawEvent.localEvent.competitionIntegrity.provenance.competitionManifestSha256 = "d".repeat(64); }],
    ["artifact", (payload) => { payload.rawEvent.localEvent.competitionIntegrity.provenance.artifactSha256 = "d".repeat(64); }],
    ["duplicate", (payload) => { payload.duplicateKey = `hsl:v2:${"d".repeat(64)}`; }],
  ];
  for (const [name, mutate] of attacks) {
    const payload = protectedPayload();
    mutate(payload);
    const state = fixture();
    const response = await resolveSubmissionIngest(payload, state.dependencies);
    assert.equal(response.status, 409, name);
    assert.equal(state.calls.includes("duplicate"), false, name);
    assert.equal(state.inserted.length, 0, name);
  }
});

test("authority and rolling-deploy failures are 503 retryable boundaries with zero insert", async () => {
  const cases: Array<[string, Partial<SubmissionIngestDependencies>]> = [
    ["service role missing", { createAdminClient: () => null }],
    ["policy table missing", { loadPolicy: async () => ({ data: null, error: { code: "42P01" } }) }],
    ["policy query throws", { loadPolicy: async () => { throw new Error("db-down"); } }],
    ["malformed policy", { loadPolicy: async () => ({ data: { ...competitionPolicyRow(), mode: "other" }, error: null }) }],
    ["pack catalog down", { loadPack: async () => ({ data: null, error: { code: "XX000" } }) }],
    ["draft pack", { loadPack: async () => ({ data: competitionPackRow("draft"), error: null }) }],
    ["manifest missing", { loadPack: async () => ({ data: { ...competitionPackRow(), competition_manifest_sha256: null }, error: null }) }],
  ];
  for (const [name, overrides] of cases) {
    const state = fixture(overrides);
    const response = await resolveSubmissionIngest(protectedPayload(), state.dependencies);
    assert.equal(response.status, 503, name);
    assert.equal(response.body.code, "COMPETITION_AUTHORITY_UNAVAILABLE", name);
    assert.equal(state.inserted.length, 0, name);
  }
});

test("policy absence preserves legacy but never silently downgrades an explicit v2 event", async () => {
  const noPolicy = { loadPolicy: async () => ({ data: null, error: null }) };
  const protectedState = fixture(noPolicy);
  const protectedResponse = await resolveSubmissionIngest(protectedPayload(), protectedState.dependencies);
  assert.equal(protectedResponse.status, 503);
  assert.equal(protectedResponse.body.code, "COMPETITION_AUTHORITY_UNAVAILABLE");
  assert.equal(protectedState.inserted.length, 0);

  const legacyState = fixture(noPolicy);
  const legacyPayload = {
    weekId: WEEK_ID,
    score: 900,
    detectedAt: DETECTED_AT,
    source: "mame_plugin",
    rom: "invaders",
    mameVersion: "0.287",
    clientVersion: "0.2.0",
    duplicateKey: `hsl:v1:${"e".repeat(64)}`,
  };
  const legacyResponse = await resolveSubmissionIngest(legacyPayload, legacyState.dependencies);
  assert.equal(legacyResponse.status, 201, JSON.stringify(legacyResponse));
  assert.equal(legacyState.inserted.length, 1);
  assert.equal(legacyState.inserted[0].competition_integrity_version, null);
  assert.equal(legacyState.inserted[0].launcher_pack_id, null);
  assert.equal(legacyState.inserted[0].raw_event, null);
  assert.equal(legacyState.inserted[0].duplicate_key, legacyPayload.duplicateKey);
});

test("exact Protected duplicate succeeds before mutable membership/window even after pack disable", async () => {
  const state = fixture({
    loadPack: async () => ({ data: competitionPackRow("disabled"), error: null }),
    loadMembership: async () => { throw new Error("must-not-run"); },
  });
  state.setDuplicate(existingProtected());
  const response = await resolveSubmissionIngest(protectedPayload(), state.dependencies);
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(response.body.duplicate, true);
  assert.equal(state.calls.includes("membership"), false);
  assert.equal(state.inserted.length, 0);
});

test("same duplicate key with different canonical identity is a terminal conflict", async () => {
  const state = fixture();
  state.setDuplicate(existingProtected({ competition_candidate_id: "another_candidate" }));
  const response = await resolveSubmissionIngest(protectedPayload(), state.dependencies);
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "DUPLICATE_KEY_CONFLICT");
  assert.equal(state.inserted.length, 0);
});

test("new scores still require membership and historical detectedAt window", async () => {
  const noMembership = fixture({ loadMembership: async () => ({ data: null, error: null }) });
  const membershipResponse = await resolveSubmissionIngest(protectedPayload(), noMembership.dependencies);
  assert.equal(membershipResponse.status, 403);
  assert.equal(noMembership.inserted.length, 0);

  const outside = protectedPayload();
  outside.detectedAt = "2026-08-21T11:00:00.000Z";
  outside.rawEvent.localEvent.detectedAt = outside.detectedAt;
  outside.rawEvent.localEvent.competitionIntegrity.event.detectedAt = outside.detectedAt;
  const outsideState = fixture();
  const outsideResponse = await resolveSubmissionIngest(outside, outsideState.dependencies);
  assert.equal(outsideResponse.status, 409);
  assert.equal(outsideResponse.body.code, "WEEK_CLOSED_AT_DETECTION");
  assert.equal(outsideState.inserted.length, 0);

  const freeze = protectedPayload();
  freeze.detectedAt = "2026-08-21T10:45:00.000Z";
  freeze.rawEvent.localEvent.detectedAt = freeze.detectedAt;
  freeze.rawEvent.localEvent.competitionIntegrity.event.detectedAt = freeze.detectedAt;
  const freezeState = fixture();
  const freezeResponse = await resolveSubmissionIngest(freeze, freezeState.dependencies);
  assert.equal(freezeResponse.status, 201);
  assert.equal(freezeState.inserted[0].is_hidden, true);
});

test("a 23505 race is confirmed only by rereading an exact canonical duplicate", async () => {
  let lookup = 0;
  const state = fixture({
    findDuplicate: async () => ({ data: ++lookup === 1 ? null : existingProtected(), error: null }),
    insertSubmission: async () => ({ data: null, error: { code: "23505" } }),
  });
  const response = await resolveSubmissionIngest(protectedPayload(), state.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.body.duplicate, true);
  assert.equal(lookup, 2);
});
