export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const WEEK_ID = "22222222-2222-4222-8222-222222222222";
export const SEASON_ID = "33333333-3333-4333-8333-333333333333";
export const PACK_ID = "fixture-pack-r2";
export const RUN_ID = "run_fixture_001";
export const CANDIDATE_ID = "run_fixture_001_candidate_000001";
export const PLAYER_BINDING = "905e441e7f335c2f293a0518329b2733f8f5dcd2f118644f2841f0df92ed3c79";
export const MANIFEST_SHA256 = "a".repeat(64);
export const ARTIFACT_SHA256 = "b".repeat(64);
export const RUN_INPUT_SHA256 = "c".repeat(64);
export const DUPLICATE_KEY = "hsl:v2:40e1b6c29cabc144f1d9c3c31fbc91fad36fddb474b1ccc36fa04b756e8eafea";
export const DETECTED_AT = "2026-08-21T10:00:01.000Z";
export const DIPS = [
  { portTag: ":IN2", mask: 3, value: 0 },
  { portTag: ":IN2", mask: 8, value: 0 },
];

export function competitionPolicyRow() {
  return {
    week_id: WEEK_ID,
    policy_version: 1,
    mode: "protected_v2",
    launcher_pack_id: PACK_ID,
    evidence_version: 2,
    guard_version: 2,
    rom_name: "invaders",
    mame_version: "0.287",
    plugin_version: "0.4.0",
    source: "mame_memory",
    dips: structuredClone(DIPS),
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
  };
}

export function competitionPackRow(status: "published" | "disabled" | "draft" = "published") {
  return {
    pack_id: PACK_ID,
    week_id: WEEK_ID,
    size_bytes: 123456,
    sha256: ARTIFACT_SHA256,
    competition_manifest_sha256: MANIFEST_SHA256,
    status,
    published_at: status === "draft" ? null : "2026-08-20T11:00:00.000Z",
  };
}

export function protectedPayload() {
  const evidence = {
    version: 2,
    guardVersion: 2,
    runId: RUN_ID,
    weekId: WEEK_ID,
    playerBinding: PLAYER_BINDING,
    packId: PACK_ID,
    manifestSha256: MANIFEST_SHA256,
    mameVersion: "0.287",
    pluginVersion: "0.4.0",
    captureClientVersion: "0.3.0",
    runInputManifestSha256: RUN_INPUT_SHA256,
    dips: structuredClone(DIPS),
    violations: [] as string[],
    provenance: {
      artifactSha256: ARTIFACT_SHA256,
      artifactSizeBytes: 123456,
      competitionManifestSha256: MANIFEST_SHA256,
      mode: "remote_verified",
    },
    event: {
      candidateId: CANDIDATE_ID,
      rom: "invaders",
      score: 1230,
      detectedAt: DETECTED_AT,
      source: "mame_memory",
    },
  };
  const localEvent = {
    schemaVersion: 1,
    candidateId: CANDIDATE_ID,
    runId: RUN_ID,
    packId: PACK_ID,
    game: "Space Invaders",
    rom: "invaders",
    score: 1230,
    detectedAt: DETECTED_AT,
    source: "mame_memory",
    mameVersion: "0.287",
    pluginVersion: "0.4.0",
    competitionIntegrity: evidence,
  };
  return {
    weekId: WEEK_ID,
    score: 1230,
    detectedAt: DETECTED_AT,
    source: "mame_memory",
    rom: "invaders",
    mameVersion: "0.287",
    clientVersion: "0.4.0",
    comment: "Fixture WEB independiente",
    rawEvent: {
      schemaVersion: 1,
      game: "Space Invaders",
      pluginVersion: "0.4.0",
      detection: { method: "fixture" },
      scoreData: { displayScore: 1230 },
      localEvent,
    },
    duplicateKey: DUPLICATE_KEY,
  };
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
