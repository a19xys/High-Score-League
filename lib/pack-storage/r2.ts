import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const R2_HEAD_TIMEOUT_MS = 7_500;

export type PackStorageHeadResult =
  | { ok: true; contentLength: number | null }
  | { ok: false; reason: "not-found" | "unavailable" };

export type PackStoragePresignResult =
  | { ok: true; url: string }
  | { ok: false; reason: "unavailable" };

export type LauncherPackStorage = {
  headObject(key: string): Promise<PackStorageHeadResult>;
  presignGet(key: string, expiresInSeconds: number): Promise<PackStoragePresignResult>;
};

type R2Jurisdiction = "default" | "eu" | "fedramp";

type R2Configuration = {
  accessKeyId: string;
  accountId: string;
  bucket: string;
  endpoint: string;
  jurisdiction: R2Jurisdiction;
  secretAccessKey: string;
};

type R2Environment = Record<string, string | undefined>;

const accountIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const bucketPattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const jurisdictions = new Set<R2Jurisdiction>(["default", "eu", "fedramp"]);

export function buildR2Endpoint(accountId: string, jurisdiction: R2Jurisdiction) {
  const jurisdictionLabel = jurisdiction === "default" ? "" : `.${jurisdiction}`;
  return `https://${accountId}${jurisdictionLabel}.r2.cloudflarestorage.com`;
}

function readR2Configuration(env: R2Environment): R2Configuration | null {
  const accountId = env.HSL_R2_ACCOUNT_ID?.trim() || "";
  const bucket = env.HSL_R2_BUCKET?.trim() || "";
  const accessKeyId = env.HSL_R2_ACCESS_KEY_ID?.trim() || "";
  const secretAccessKey = env.HSL_R2_SECRET_ACCESS_KEY?.trim() || "";
  const jurisdiction = env.HSL_R2_JURISDICTION?.trim() as R2Jurisdiction | undefined;

  if (
    !accountIdPattern.test(accountId) ||
    !bucketPattern.test(bucket) ||
    !accessKeyId ||
    !secretAccessKey ||
    !jurisdiction ||
    !jurisdictions.has(jurisdiction)
  ) {
    return null;
  }

  return {
    accessKeyId,
    accountId,
    bucket,
    endpoint: buildR2Endpoint(accountId, jurisdiction),
    jurisdiction,
    secretAccessKey,
  };
}

export function getR2PackStorageConfiguration(
  env: R2Environment = process.env,
) {
  const accountId = env.HSL_R2_ACCOUNT_ID?.trim() || "";
  const bucket = env.HSL_R2_BUCKET?.trim() || "";
  const jurisdiction = env.HSL_R2_JURISDICTION?.trim() as R2Jurisdiction | undefined;
  const accountIdValid = accountIdPattern.test(accountId);
  const bucketValid = bucketPattern.test(bucket);
  const jurisdictionValid = Boolean(jurisdiction && jurisdictions.has(jurisdiction));
  const credentialsConfigured = Boolean(
    env.HSL_R2_ACCESS_KEY_ID?.trim() && env.HSL_R2_SECRET_ACCESS_KEY?.trim(),
  );

  return {
    accountIdValid,
    available: accountIdValid && bucketValid && jurisdictionValid && credentialsConfigured,
    bucketValid,
    credentialsConfigured,
    endpoint: accountIdValid && jurisdictionValid
      ? buildR2Endpoint(accountId, jurisdiction as R2Jurisdiction)
      : null,
    jurisdiction: jurisdictionValid ? jurisdiction : null,
    jurisdictionValid,
  };
}

export function classifyR2HeadError(error: unknown): "not-found" | "unavailable" {
  const provider = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const code = String(provider.name || provider.Code || provider.code || "").toLowerCase();

  if (["nosuchkey", "notfound", "no_such_key"].includes(code)) return "not-found";
  return "unavailable";
}

export function createR2PackStorage(
  env: R2Environment = process.env,
): LauncherPackStorage | null {
  const config = readR2Configuration(env);
  if (!config) return null;

  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    region: "auto",
  });

  return {
    async headObject(key) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), R2_HEAD_TIMEOUT_MS);

      try {
        const response = await client.send(new HeadObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }), { abortSignal: controller.signal });
        return {
          ok: true,
          contentLength: typeof response.ContentLength === "number"
            ? response.ContentLength
            : null,
        };
      } catch (error) {
        return { ok: false, reason: classifyR2HeadError(error) };
      } finally {
        clearTimeout(timeout);
      }
    },

    async presignGet(key, expiresInSeconds) {
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: config.bucket, Key: key }),
          { expiresIn: expiresInSeconds },
        );
        return { ok: true, url };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
  };
}
