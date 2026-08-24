import { createHash } from "node:crypto";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const EVIDENCE_FIELDS = [
  "captureClientVersion",
  "dips",
  "event",
  "guardVersion",
  "mameVersion",
  "manifestSha256",
  "packId",
  "playerBinding",
  "pluginVersion",
  "provenance",
  "runId",
  "runInputManifestSha256",
  "version",
  "violations",
  "weekId",
] as const;
const EVENT_FIELDS = ["candidateId", "detectedAt", "rom", "score", "source"] as const;
const PROVENANCE_FIELDS = [
  "artifactSha256",
  "artifactSizeBytes",
  "competitionManifestSha256",
  "mode",
] as const;
const DIP_FIELDS = ["mask", "portTag", "value"] as const;
const KNOWN_VIOLATIONS = new Set([
  "dip_changed",
  "pause",
  "state_save",
  "state_load",
  "machine_reset",
  "menu_opened",
  "speed_changed",
  "throttle_changed",
  "run_input_changed",
  "integrity_unavailable",
]);

type JsonObject = Record<string, unknown>;

export type CompetitionDip = {
  portTag: string;
  mask: number;
  value: number;
};

export type CompetitionPolicy = {
  weekId: string;
  policyVersion: 1;
  mode: "protected_v2";
  launcherPackId: string;
  evidenceVersion: 2;
  guardVersion: 2;
  romName: string;
  mameVersion: string;
  pluginVersion: string;
  source: "mame_memory";
  dips: CompetitionDip[];
  policyFingerprint: string;
  frozenAt: string | null;
};

export type CompetitionPackAuthority = {
  packId: string;
  weekId: string;
  sizeBytes: number;
  sha256: string;
  competitionManifestSha256: string;
  status: "published" | "disabled";
  publishedAt: string;
};

export type CompetitionAuthority = {
  policy: CompetitionPolicy;
  pack: CompetitionPackAuthority;
};

export type ProtectedSubmissionInput = {
  weekId: string;
  score: number;
  detectedAt: string;
  source: string;
  romName: string | null;
  mameVersion: string | null;
  rawEvent: JsonObject | null;
  duplicateKey: string | null;
};

export type ProtectedSubmissionIdentity = {
  launcherPackId: string;
  competitionIntegrityVersion: 2;
  competitionManifestSha256: string;
  competitionPolicyFingerprint: string;
  competitionRunId: string;
  competitionCandidateId: string;
  duplicateKey: string;
};

export type CompetitionValidationResult =
  | { ok: true; identity: ProtectedSubmissionIdentity }
  | { ok: false; code: string; error: string };

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function exactKeys(value: JsonObject, fields: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...fields].sort().join(",");
}

function boundedString(value: unknown, maximum = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function invalid(code: string, error: string): CompetitionValidationResult {
  return { ok: false, code, error };
}

export function deriveCompetitionPlayerBinding(userId: string) {
  return sha256(`hsl-player-binding:v1|${userId}`);
}

export function deriveCompetitionDuplicateKey(input: {
  weekId: string;
  playerBinding: string;
  packId: string;
  manifestSha256: string;
  runId: string;
  candidateId: string;
}) {
  const stableParts = [
    "hsl",
    "v2",
    input.weekId,
    input.playerBinding,
    input.packId,
    input.manifestSha256,
    input.runId,
    input.candidateId,
  ];
  return `hsl:v2:${sha256(stableParts.join("|"))}`;
}

function normalizeDips(value: unknown): CompetitionDip[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const normalized: CompetitionDip[] = [];
  const seen = new Set<string>();
  let previous: CompetitionDip | null = null;

  for (const rawDip of value) {
    const dip = objectValue(rawDip);
    if (!dip || !exactKeys(dip, DIP_FIELDS)
        || !boundedString(dip.portTag)
        || !Number.isSafeInteger(dip.mask) || Number(dip.mask) <= 0 || Number(dip.mask) > 0xffffffff
        || !Number.isSafeInteger(dip.value) || Number(dip.value) < 0 || Number(dip.value) > 0xffffffff
        || (BigInt(Number(dip.value)) & ~BigInt(Number(dip.mask))) !== BigInt(0)) {
      return null;
    }
    const item = {
      portTag: dip.portTag,
      mask: Number(dip.mask),
      value: Number(dip.value),
    };
    const identity = `${item.portTag}\u0000${item.mask}`;
    if (seen.has(identity)
        || (previous && (previous.portTag > item.portTag
          || (previous.portTag === item.portTag && previous.mask >= item.mask)))) {
      return null;
    }
    seen.add(identity);
    previous = item;
    normalized.push(item);
  }
  return normalized;
}

export function validateCompetitionPolicyRow(
  value: unknown,
  expectedWeekId: string,
): CompetitionPolicy | null {
  const row = objectValue(value);
  const dips = normalizeDips(row?.dips);
  if (!row
      || row.week_id !== expectedWeekId
      || row.policy_version !== 1
      || row.mode !== "protected_v2"
      || row.evidence_version !== 2
      || row.guard_version !== 2
      || !PACK_ID_PATTERN.test(String(row.launcher_pack_id || ""))
      || !boundedString(row.rom_name, 64)
      || !boundedString(row.mame_version, 32)
      || !boundedString(row.plugin_version, 32)
      || row.source !== "mame_memory"
      || typeof row.policy_fingerprint !== "string"
      || !SHA256_PATTERN.test(row.policy_fingerprint)
      || (row.frozen_at !== null
        && (typeof row.frozen_at !== "string"
          || !row.frozen_at
          || Number.isNaN(new Date(row.frozen_at).getTime())))
      || !dips) {
    return null;
  }
  return {
    weekId: expectedWeekId,
    policyVersion: 1,
    mode: "protected_v2",
    launcherPackId: String(row.launcher_pack_id),
    evidenceVersion: 2,
    guardVersion: 2,
    romName: row.rom_name,
    mameVersion: row.mame_version,
    pluginVersion: row.plugin_version,
    source: "mame_memory",
    dips,
    policyFingerprint: row.policy_fingerprint,
    frozenAt: row.frozen_at as string | null,
  };
}

export function validateCompetitionPackAuthority(
  value: unknown,
  policy: CompetitionPolicy,
): CompetitionPackAuthority | null {
  const row = objectValue(value);
  const sizeBytes = Number(row?.size_bytes);
  const status = String(row?.status);
  const statusIsValid = policy.frozenAt === null
    ? status === "published"
    : ["published", "disabled"].includes(status);
  if (!row
      || row.pack_id !== policy.launcherPackId
      || row.week_id !== policy.weekId
      || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 1024 * 1024 * 1024
      || typeof row.sha256 !== "string" || !SHA256_PATTERN.test(row.sha256)
      || typeof row.competition_manifest_sha256 !== "string"
      || !SHA256_PATTERN.test(row.competition_manifest_sha256)
      || !statusIsValid
      || typeof row.published_at !== "string" || !row.published_at
      || Number.isNaN(new Date(row.published_at).getTime())) {
    return null;
  }
  return {
    packId: row.pack_id as string,
    weekId: row.week_id as string,
    sizeBytes,
    sha256: row.sha256,
    competitionManifestSha256: row.competition_manifest_sha256,
    status: row.status as "published" | "disabled",
    publishedAt: row.published_at,
  };
}

export function rawEventClaimsProtected(rawEvent: JsonObject | null) {
  const localEvent = objectValue(rawEvent?.localEvent);
  const evidence = objectValue(localEvent?.competitionIntegrity);
  return evidence?.version === 2;
}

export function validateProtectedCompetitionSubmission(options: {
  input: ProtectedSubmissionInput;
  authenticatedUserId: string;
  authority: CompetitionAuthority;
}): CompetitionValidationResult {
  const { input, authority } = options;
  const localEvent = objectValue(input.rawEvent?.localEvent);
  const evidence = objectValue(localEvent?.competitionIntegrity);
  if (!input.rawEvent || !localEvent || !evidence) {
    return invalid(
      "COMPETITION_INTEGRITY_REQUIRED",
      "Esta semana exige una captura competitiva protegida.",
    );
  }
  if (evidence.version !== 2 || evidence.guardVersion !== 2 || !exactKeys(evidence, EVIDENCE_FIELDS)) {
    return invalid("COMPETITION_EVIDENCE_INVALID", "La evidence competitiva no cumple el contrato v2.");
  }

  const event = objectValue(evidence.event);
  const provenance = objectValue(evidence.provenance);
  const dips = normalizeDips(evidence.dips);
  if (!boundedString(evidence.runId)
      || !PACK_ID_PATTERN.test(String(evidence.packId || ""))
      || !boundedString(evidence.weekId)
      || typeof evidence.playerBinding !== "string" || !SHA256_PATTERN.test(evidence.playerBinding)
      || typeof evidence.manifestSha256 !== "string" || !SHA256_PATTERN.test(evidence.manifestSha256)
      || !boundedString(evidence.mameVersion, 32)
      || !boundedString(evidence.pluginVersion, 32)
      || !boundedString(evidence.captureClientVersion, 32)
      || typeof evidence.runInputManifestSha256 !== "string"
      || !SHA256_PATTERN.test(evidence.runInputManifestSha256)
      || !event || !exactKeys(event, EVENT_FIELDS)
      || !boundedString(event.candidateId, 192)
      || !boundedString(event.rom, 64)
      || !Number.isSafeInteger(event.score) || Number(event.score) <= 0
      || !boundedString(event.detectedAt, 64) || Number.isNaN(new Date(event.detectedAt).getTime())
      || event.source !== "mame_memory"
      || !provenance || !exactKeys(provenance, PROVENANCE_FIELDS)
      || !dips
      || !Array.isArray(evidence.violations)
      || evidence.violations.some((code) => typeof code !== "string" || !KNOWN_VIOLATIONS.has(code))) {
    return invalid("COMPETITION_EVIDENCE_INVALID", "La evidence competitiva contiene datos inválidos.");
  }
  if (evidence.violations.length !== 0) {
    return invalid("COMPETITION_EVIDENCE_INVALID", "La run protegida contiene violaciones competitivas.");
  }
  if (provenance.mode !== "remote_verified") {
    return invalid("COMPETITION_PROVENANCE_INVALID", "La provenance competitiva no es productiva.");
  }

  const expectedPlayerBinding = deriveCompetitionPlayerBinding(options.authenticatedUserId);
  if (evidence.playerBinding !== expectedPlayerBinding) {
    return invalid("COMPETITION_PLAYER_MISMATCH", "La captura no pertenece a la sesión autenticada.");
  }
  if (input.weekId !== authority.policy.weekId || evidence.weekId !== authority.policy.weekId) {
    return invalid("COMPETITION_POLICY_MISMATCH", "La semana no coincide con la policy competitiva.");
  }
  if (evidence.packId !== authority.policy.launcherPackId
      || evidence.packId !== authority.pack.packId
      || (localEvent.packId !== undefined && localEvent.packId !== evidence.packId)) {
    return invalid("COMPETITION_PACK_MISMATCH", "El pack no coincide con la revisión canónica.");
  }
  if (evidence.manifestSha256 !== authority.pack.competitionManifestSha256
      || provenance.competitionManifestSha256 !== authority.pack.competitionManifestSha256) {
    return invalid("COMPETITION_MANIFEST_MISMATCH", "El manifest no coincide con el canónico.");
  }
  if (provenance.artifactSha256 !== authority.pack.sha256
      || provenance.artifactSizeBytes !== authority.pack.sizeBytes) {
    return invalid("COMPETITION_ARTIFACT_MISMATCH", "El artifact no coincide con el canónico.");
  }
  if (input.mameVersion !== authority.policy.mameVersion
      || localEvent.mameVersion !== authority.policy.mameVersion
      || evidence.mameVersion !== authority.policy.mameVersion
      || input.rawEvent.pluginVersion !== authority.policy.pluginVersion
      || localEvent.pluginVersion !== authority.policy.pluginVersion
      || evidence.pluginVersion !== authority.policy.pluginVersion
      || input.romName !== authority.policy.romName
      || localEvent.rom !== authority.policy.romName
      || event.rom !== authority.policy.romName
      || input.source !== authority.policy.source
      || localEvent.source !== authority.policy.source
      || event.source !== authority.policy.source
      || JSON.stringify(dips) !== JSON.stringify(authority.policy.dips)) {
    return invalid("COMPETITION_POLICY_MISMATCH", "La captura contradice la policy técnica de la semana.");
  }
  if (input.score !== localEvent.score || input.score !== event.score
      || input.detectedAt !== localEvent.detectedAt || input.detectedAt !== event.detectedAt
      || localEvent.candidateId !== event.candidateId
      || localEvent.runId !== evidence.runId) {
    return invalid("COMPETITION_EVENT_BINDING_MISMATCH", "El evento no coincide con su binding protegido.");
  }

  const duplicateKey = deriveCompetitionDuplicateKey({
    weekId: authority.policy.weekId,
    playerBinding: expectedPlayerBinding,
    packId: authority.pack.packId,
    manifestSha256: authority.pack.competitionManifestSha256,
    runId: evidence.runId,
    candidateId: event.candidateId as string,
  });
  if (input.duplicateKey !== duplicateKey) {
    return invalid("COMPETITION_DUPLICATE_KEY_MISMATCH", "La clave de idempotencia no coincide con la calculada por WEB.");
  }

  return {
    ok: true,
    identity: {
      launcherPackId: authority.pack.packId,
      competitionIntegrityVersion: 2,
      competitionManifestSha256: authority.pack.competitionManifestSha256,
      competitionPolicyFingerprint: authority.policy.policyFingerprint,
      competitionRunId: evidence.runId,
      competitionCandidateId: event.candidateId as string,
      duplicateKey,
    },
  };
}
