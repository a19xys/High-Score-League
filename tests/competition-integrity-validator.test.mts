import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCompetitionDuplicateKey,
  deriveCompetitionPlayerBinding,
  rawEventClaimsProtected,
  validateCompetitionPackAuthority,
  validateCompetitionPolicyRow,
  validateProtectedCompetitionSubmission,
} from "../lib/submissions/competition-integrity.ts";
import {
  ARTIFACT_SHA256,
  CANDIDATE_ID,
  clone,
  competitionPackRow,
  competitionPolicyRow,
  DIPS,
  DUPLICATE_KEY,
  MANIFEST_SHA256,
  PACK_ID,
  PLAYER_BINDING,
  POLICY_FINGERPRINT,
  protectedPayload,
  RUN_ID,
  USER_ID,
  WEEK_ID,
} from "./fixtures/competition-integrity-v2.mts";

function validatedAuthority(status: "published" | "disabled" = "published") {
  const policy = validateCompetitionPolicyRow(
    competitionPolicyRow(status === "disabled" ? "2026-08-21T10:00:02.000Z" : null),
    WEEK_ID,
  );
  assert.ok(policy);
  const pack = validateCompetitionPackAuthority(competitionPackRow(status), policy);
  assert.ok(pack);
  return { policy, pack };
}

function validate(payload = protectedPayload(), userId = USER_ID, status: "published" | "disabled" = "published") {
  const input = {
    weekId: payload.weekId,
    score: payload.score,
    detectedAt: payload.detectedAt,
    source: payload.source,
    romName: payload.rom,
    mameVersion: payload.mameVersion,
    rawEvent: payload.rawEvent,
    duplicateKey: payload.duplicateKey,
  };
  return validateProtectedCompetitionSubmission({
    input,
    authenticatedUserId: userId,
    authority: validatedAuthority(status),
  });
}

function evidence(payload: ReturnType<typeof protectedPayload>) {
  return payload.rawEvent.localEvent.competitionIntegrity;
}

test("WEB playerBinding and hsl:v2 match fixed golden vectors without importing LOCAL", () => {
  assert.equal(deriveCompetitionPlayerBinding(USER_ID), PLAYER_BINDING);
  assert.equal(
    deriveCompetitionDuplicateKey({
      weekId: WEEK_ID,
      playerBinding: PLAYER_BINDING,
      packId: PACK_ID,
      manifestSha256: MANIFEST_SHA256,
      runId: RUN_ID,
      candidateId: CANDIDATE_ID,
    }),
    DUPLICATE_KEY,
  );
});

test("a canonical Protected v2 fixture validates and transport clientVersion may differ", () => {
  const payload = protectedPayload();
  assert.notEqual(payload.clientVersion, evidence(payload).captureClientVersion);
  assert.equal(rawEventClaimsProtected(payload.rawEvent), true);
  const result = validate(payload);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.deepEqual(result.identity, {
      launcherPackId: PACK_ID,
      competitionIntegrityVersion: 2,
      competitionManifestSha256: MANIFEST_SHA256,
      competitionPolicyFingerprint: POLICY_FINGERPRINT,
      competitionRunId: RUN_ID,
      competitionCandidateId: CANDIDATE_ID,
      duplicateKey: DUPLICATE_KEY,
    });
  }
});

const terminalAttacks: Array<[string, string, (payload: ReturnType<typeof protectedPayload>) => void]> = [
  ["missing evidence", "COMPETITION_INTEGRITY_REQUIRED", (payload) => { delete (payload.rawEvent.localEvent as any).competitionIntegrity; }],
  ["v1 evidence", "COMPETITION_EVIDENCE_INVALID", (payload) => { (payload.rawEvent.localEvent as any).competitionIntegrity = { version: 1, guardVersion: 1 }; }],
  ["guard", "COMPETITION_EVIDENCE_INVALID", (payload) => { evidence(payload).guardVersion = 1; }],
  ["unknown evidence key", "COMPETITION_EVIDENCE_INVALID", (payload) => { (evidence(payload) as any).unexpected = true; }],
  ["unknown event key", "COMPETITION_EVIDENCE_INVALID", (payload) => { (evidence(payload).event as any).unexpected = true; }],
  ["run input hash", "COMPETITION_EVIDENCE_INVALID", (payload) => { evidence(payload).runInputManifestSha256 = "invalid"; }],
  ["developer provenance", "COMPETITION_PROVENANCE_INVALID", (payload) => { (evidence(payload).provenance as any).mode = "developer_override"; }],
  ["player", "COMPETITION_PLAYER_MISMATCH", (payload) => { evidence(payload).playerBinding = "d".repeat(64); }],
  ["week", "COMPETITION_POLICY_MISMATCH", (payload) => { payload.weekId = "44444444-4444-4444-8444-444444444444"; evidence(payload).weekId = payload.weekId; }],
  ["pack revision", "COMPETITION_PACK_MISMATCH", (payload) => { evidence(payload).packId = "fixture-pack-r1"; payload.rawEvent.localEvent.packId = "fixture-pack-r1"; }],
  ["manifest", "COMPETITION_MANIFEST_MISMATCH", (payload) => { evidence(payload).manifestSha256 = "d".repeat(64); evidence(payload).provenance.competitionManifestSha256 = "d".repeat(64); }],
  ["artifact hash", "COMPETITION_ARTIFACT_MISMATCH", (payload) => { evidence(payload).provenance.artifactSha256 = "d".repeat(64); }],
  ["artifact size", "COMPETITION_ARTIFACT_MISMATCH", (payload) => { evidence(payload).provenance.artifactSizeBytes = 654321; }],
  ["MAME", "COMPETITION_POLICY_MISMATCH", (payload) => { payload.mameVersion = "0.999"; payload.rawEvent.localEvent.mameVersion = "0.999"; evidence(payload).mameVersion = "0.999"; }],
  ["plugin", "COMPETITION_POLICY_MISMATCH", (payload) => { payload.rawEvent.pluginVersion = "9.9.9"; payload.rawEvent.localEvent.pluginVersion = "9.9.9"; evidence(payload).pluginVersion = "9.9.9"; }],
  ["ROM", "COMPETITION_POLICY_MISMATCH", (payload) => { payload.rom = "pacman"; payload.rawEvent.localEvent.rom = "pacman"; evidence(payload).event.rom = "pacman"; }],
  ["source", "COMPETITION_EVIDENCE_INVALID", (payload) => { payload.source = "local_app"; payload.rawEvent.localEvent.source = "local_app"; evidence(payload).event.source = "local_app"; }],
  ["score binding", "COMPETITION_EVENT_BINDING_MISMATCH", (payload) => { payload.score += 1; }],
  ["detectedAt binding", "COMPETITION_EVENT_BINDING_MISMATCH", (payload) => { payload.detectedAt = "2026-08-21T10:00:02.000Z"; }],
  ["candidate binding", "COMPETITION_EVENT_BINDING_MISMATCH", (payload) => { payload.rawEvent.localEvent.candidateId = "other_candidate"; }],
  ["run binding", "COMPETITION_EVENT_BINDING_MISMATCH", (payload) => { payload.rawEvent.localEvent.runId = "other_run"; }],
  ["duplicateKey", "COMPETITION_DUPLICATE_KEY_MISMATCH", (payload) => { payload.duplicateKey = `hsl:v2:${"d".repeat(64)}`; }],
];

for (const [name, code, mutate] of terminalAttacks) {
  test(`Protected validator rejects ${name}`, () => {
    const payload = protectedPayload();
    mutate(payload);
    const result = validate(payload);
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.code, code, name);
  });
}

test("DIPs require exact canonical equality", () => {
  const mutations: Array<[string, (dips: typeof DIPS) => unknown]> = [
    ["value", (dips) => { dips[0].value = 1; }],
    ["mask", (dips) => { dips[0].mask = 4; }],
    ["port", (dips) => { dips[0].portTag = ":IN1"; }],
    ["added", (dips) => { dips.push({ portTag: ":IN3", mask: 1, value: 0 }); }],
    ["removed", (dips) => { dips.pop(); }],
    ["reordered", (dips) => { dips.reverse(); }],
    ["duplicate", (dips) => { dips.push(clone(dips[1])); }],
  ];
  for (const [name, mutate] of mutations) {
    const payload = protectedPayload();
    mutate(evidence(payload).dips as typeof DIPS);
    const result = validate(payload);
    assert.equal(result.ok, false, name);
  }
});

test("every known violation makes a productive Protected submission ineligible", () => {
  for (const code of [
    "dip_changed", "pause", "state_save", "state_load", "machine_reset",
    "menu_opened", "speed_changed", "throttle_changed", "run_input_changed",
    "integrity_unavailable",
  ]) {
    const payload = protectedPayload();
    evidence(payload).violations = [code];
    const result = validate(payload);
    assert.equal(result.ok, false, code);
    if (!result.ok) assert.equal(result.code, "COMPETITION_EVIDENCE_INVALID", code);
  }
});

test("policy and pack authority reject malformed, cross-week, draft and manifest-less rows", () => {
  assert.equal(validateCompetitionPolicyRow({ ...competitionPolicyRow(), dips: [...DIPS].reverse() }, WEEK_ID), null);
  assert.equal(validateCompetitionPolicyRow({ ...competitionPolicyRow(), week_id: "other" }, WEEK_ID), null);
  assert.equal(validateCompetitionPolicyRow({ ...competitionPolicyRow(), policy_fingerprint: "invalid" }, WEEK_ID), null);
  assert.equal(validateCompetitionPolicyRow({ ...competitionPolicyRow(), frozen_at: "invalid" }, WEEK_ID), null);
  const policy = validateCompetitionPolicyRow(competitionPolicyRow(), WEEK_ID);
  assert.ok(policy);
  assert.equal(validateCompetitionPackAuthority(competitionPackRow("draft"), policy), null);
  assert.equal(validateCompetitionPackAuthority(competitionPackRow("disabled"), policy), null);
  assert.equal(validateCompetitionPackAuthority({ ...competitionPackRow(), competition_manifest_sha256: null }, policy), null);
  assert.equal(validateCompetitionPackAuthority({ ...competitionPackRow(), sha256: "d" }, policy), null);
  const frozenPolicy = validateCompetitionPolicyRow(
    competitionPolicyRow("2026-08-21T10:00:02.000Z"),
    WEEK_ID,
  );
  assert.ok(frozenPolicy);
  assert.ok(validateCompetitionPackAuthority(competitionPackRow("disabled"), frozenPolicy));
  assert.equal(competitionPackRow().sha256, ARTIFACT_SHA256);
});

test("a fully reimplemented client can still fabricate a coherent score; WEB is not attestation", () => {
  const payload = protectedPayload();
  payload.score = 999999;
  payload.rawEvent.localEvent.score = 999999;
  evidence(payload).event.score = 999999;
  assert.equal(validate(payload).ok, true);
});
