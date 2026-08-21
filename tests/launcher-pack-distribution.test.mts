import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildLauncherPackDescriptor,
  deriveLauncherPackObjectKey,
  isLauncherPackId,
  LAUNCHER_PACK_MAX_SIZE_BYTES,
  LAUNCHER_PACK_PRESIGN_TTL_SECONDS,
  validateLauncherPackCatalogRow,
} from "../lib/launcher-pack-distribution.ts";
import {
  type LauncherPackDownloadDependencies,
  resolveLauncherPackDownload,
} from "../lib/api/launcher-pack-download.ts";
import {
  buildR2Endpoint,
  classifyR2HeadError,
  createR2PackStorage,
  getR2PackStorageConfiguration,
  R2_HEAD_TIMEOUT_MS,
} from "../lib/pack-storage/r2.ts";
import { resolvePublicRankingCapability } from "../lib/launcher-ranking-capabilities.ts";
import { resolvePublicWeekVisibility } from "../lib/public-week-visibility.ts";
import { getSupabaseEnv } from "../lib/supabase/env.ts";

const require = createRequire(import.meta.url);
const { validatePackDescriptor } = require("../local/hsl-local-app/src/remote-pack-import.js");
const { isRemotePackId } = require("../local/hsl-local-app/src/pack-deeplink.js");

const PACK_ID = "space-invaders-s1-w1";
const WEEK_ID = "11111111-1111-4111-8111-111111111111";
const SHA256 = "a".repeat(64);
const DOWNLOAD_URL = "https://packs.example.test/object.zip?X-Amz-Signature=signed";

function publishedPack(overrides: Record<string, unknown> = {}) {
  return {
    pack_id: PACK_ID,
    week_id: WEEK_ID,
    size_bytes: 8,
    sha256: SHA256,
    object_key: deriveLauncherPackObjectKey(PACK_ID, SHA256),
    status: "published",
    published_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

type HarnessOptions = {
  activeProfile?: boolean;
  adminConfigured?: boolean;
  authClientConfigured?: boolean;
  catalog?: unknown;
  catalogError?: unknown;
  claims?: unknown;
  claimsError?: unknown;
  profileError?: string | null;
  storageConfigured?: boolean;
  throwAdminFactory?: boolean;
  throwBearerFactory?: boolean;
  throwGetClaims?: boolean;
  throwGetUser?: boolean;
  user?: { id: string } | null;
  userError?: unknown;
  visibility?: { ok: true; available: boolean } | { ok: false };
  head?: Awaited<ReturnType<NonNullable<ReturnType<LauncherPackDownloadDependencies["createStorage"]>>["headObject"]>>;
  presign?: Awaited<ReturnType<NonNullable<ReturnType<LauncherPackDownloadDependencies["createStorage"]>>["presignGet"]>>;
};

function createHarness(options: HarnessOptions = {}) {
  const settings = {
    activeProfile: true,
    adminConfigured: true,
    authClientConfigured: true,
    catalog: publishedPack(),
    catalogError: null,
    claims: {
      role: "authenticated",
      sub: "player-1",
      amr: [{ method: "password", timestamp: 1 }],
    },
    claimsError: null,
    profileError: null,
    storageConfigured: true,
    throwAdminFactory: false,
    throwBearerFactory: false,
    throwGetClaims: false,
    throwGetUser: false,
    user: { id: "player-1" },
    userError: null,
    visibility: { ok: true, available: true } as const,
    head: { ok: true, contentLength: 8 } as const,
    presign: { ok: true, url: DOWNLOAD_URL } as const,
    ...options,
  };
  const calls = {
    admin: 0,
    bearer: 0,
    catalog: 0,
    getClaims: 0,
    getUser: 0,
    head: 0,
    membership: 0,
    presign: 0,
    profile: 0,
    storage: 0,
    visibility: 0,
  };
  const storageOrder: string[] = [];
  const operationOrder: string[] = [];
  const dependencies: LauncherPackDownloadDependencies = {
    createBearerClient: () => {
      calls.bearer += 1;
      operationOrder.push("bearer-client");
      if (settings.throwBearerFactory) throw new Error("private supabase detail secret");
      if (!settings.authClientConfigured) return null;
      return {
        auth: {
          getClaims: async () => {
            calls.getClaims += 1;
            operationOrder.push("get-claims");
            if (settings.throwGetClaims) throw new Error("private claims transport failure secret");
            return {
              data: settings.claims ? { claims: settings.claims } : null,
              error: settings.claimsError,
            };
          },
          getUser: async () => {
            calls.getUser += 1;
            operationOrder.push("get-user");
            if (settings.throwGetUser) throw new Error("private auth transport failure secret");
            return {
              data: { user: settings.user },
              error: settings.userError,
            };
          },
        },
      };
    },
    createAdminClient: () => {
      calls.admin += 1;
      operationOrder.push("admin-client");
      if (settings.throwAdminFactory) throw new Error("private service role detail secret");
      return settings.adminConfigured ? {} : null;
    },
    createStorage: () => {
      calls.storage += 1;
      operationOrder.push("storage");
      if (!settings.storageConfigured) return null;
      return {
        headObject: async () => {
          calls.head += 1;
          operationOrder.push("head");
          storageOrder.push("head");
          return settings.head;
        },
        presignGet: async (_key, expiresInSeconds) => {
          calls.presign += 1;
          operationOrder.push("presign");
          storageOrder.push("presign");
          assert.equal(expiresInSeconds, LAUNCHER_PACK_PRESIGN_TTL_SECONDS);
          return settings.presign;
        },
      };
    },
    checkActiveProfile: async () => {
      calls.profile += 1;
      operationOrder.push("profile");
      return { active: settings.activeProfile, error: settings.profileError };
    },
    loadCatalogPack: async () => {
      calls.catalog += 1;
      operationOrder.push("catalog");
      return { data: settings.catalog, error: settings.catalogError };
    },
    loadWeekVisibility: async () => {
      calls.visibility += 1;
      operationOrder.push("visibility");
      return settings.visibility;
    },
    now: () => new Date("2026-08-20T00:00:00.000Z"),
  };

  return {
    calls,
    operationOrder,
    storageOrder,
    resolve: (
      authorization: string | null = "Bearer launcher-session",
      packId = PACK_ID,
    ) => resolveLauncherPackDownload(
      new Request("https://hsl.example/api/launcher/packs/x/download", {
        headers: authorization ? { Authorization: authorization } : {},
      }) as never,
      packId,
      dependencies,
    ),
  };
}

test("web packId coincide byte por byte con el launcher local", () => {
  const valid = ["space-invaders", "space-invaders-s1-w1", "space_invaders_v2", "a", "a1_b-2"];
  const invalid = [
    "SpaceInvaders", "-space", "_space", "foo/bar", "foo.bar", "foo%20bar", "foo?x",
    "foo#x", "../foo", "", `a${"b".repeat(128)}`,
  ];

  for (const value of [...valid, ...invalid]) {
    assert.equal(isLauncherPackId(value), isRemotePackId(value), value);
  }
  for (const value of valid) assert.equal(isLauncherPackId(value), true, value);
  for (const value of invalid) assert.equal(isLauncherPackId(value), false, value);
});

test("descriptor WEB exacto es aceptado por LOCAL y campos extra siguen rechazados", () => {
  const pack = validateLauncherPackCatalogRow(publishedPack(), PACK_ID);
  assert.ok(pack);
  const descriptor = buildLauncherPackDescriptor({ pack, downloadUrl: DOWNLOAD_URL });
  assert.ok(descriptor);
  assert.deepEqual(Object.keys(descriptor).sort(), ["artifact", "packId", "version"]);
  assert.deepEqual(Object.keys(descriptor.artifact).sort(), ["downloadUrl", "sha256", "sizeBytes"]);
  const localDescriptor = validatePackDescriptor(descriptor, PACK_ID);
  assert.equal(localDescriptor.packId, PACK_ID);
  assert.equal(localDescriptor.artifact.sizeBytes, 8);
  assert.equal(localDescriptor.artifact.sha256, SHA256);
  assert.throws(
    () => validatePackDescriptor({ ...descriptor, weekId: WEEK_ID }, PACK_ID),
    (error: { code?: string }) => error.code === "invalid_descriptor",
  );
});

test("catálogo se valida defensivamente y object_key sólo deriva de packId + sha256", () => {
  assert.equal(
    deriveLauncherPackObjectKey(PACK_ID, SHA256),
    `packs/v1/${PACK_ID}/${SHA256}.hslpack.zip`,
  );
  assert.ok(validateLauncherPackCatalogRow(publishedPack(), PACK_ID));

  const invalidRows = [
    publishedPack({ pack_id: "other-pack" }),
    publishedPack({ week_id: "week-1" }),
    publishedPack({ status: "draft" }),
    publishedPack({ published_at: null }),
    publishedPack({ size_bytes: 0 }),
    publishedPack({ size_bytes: LAUNCHER_PACK_MAX_SIZE_BYTES + 1 }),
    publishedPack({ sha256: "A".repeat(64) }),
    publishedPack({ object_key: "packs/arbitrary.zip" }),
  ];
  for (const row of invalidRows) assert.equal(validateLauncherPackCatalogRow(row, PACK_ID), null);
});

test("ranking y packs comparten la misma matriz pública", () => {
  const baseWeek = { game_id: "game-1", status: "active", week_number: 1 };
  for (const derivedStatus of ["draft", "scheduled", "active", "final_stretch", "closed", "published"]) {
    const season = { status: derivedStatus === "published" ? "completed" : "active" };
    const input = { week: { ...baseWeek, status: derivedStatus }, season, derivedStatus, currentActiveWeekNumber: 1 };
    assert.deepEqual(resolvePublicRankingCapability(input), resolvePublicWeekVisibility(input));
    assert.equal(
      resolvePublicWeekVisibility(input).status,
      ["active", "final_stretch", "closed", "published"].includes(derivedStatus) ? "available" : "unavailable",
    );
  }
  assert.equal(resolvePublicWeekVisibility({
    week: { ...baseWeek, week_number: 2 },
    season: { status: "active" },
    derivedStatus: "active",
    currentActiveWeekNumber: 1,
  }).status, "unavailable");
});

test("Bearer ausente o malformado es 401 y no inicializa ningún backend", async () => {
  for (const authorization of [null, "Basic abc", "Bearer", "Bearer ", "Bearer token extra"]) {
    const scenario = createHarness();
    const result = await scenario.resolve(authorization);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, {
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Necesitas una sesión válida.",
    });
    assert.deepEqual(scenario.calls, {
      admin: 0,
      bearer: 0,
      catalog: 0,
      getClaims: 0,
      getUser: 0,
      head: 0,
      membership: 0,
      presign: 0,
      profile: 0,
      storage: 0,
      visibility: 0,
    });
  }
});

test("factory bearer null/throw y fallos de claims/user son 503 sin filtrar detalles", async () => {
  const cases = [
    createHarness({ authClientConfigured: false }),
    createHarness({ throwBearerFactory: true }),
    createHarness({ throwGetClaims: true }),
    createHarness({ throwGetUser: true }),
  ];

  for (const scenario of cases) {
    const result = await scenario.resolve();
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, {
      ok: false,
      code: "PACK_AUTH_UNAVAILABLE",
      error: "La distribución de packs no está disponible.",
    });
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private|supabase|next_public|anon_key|transport|stack|secret|url/i,
    );
    assert.equal(scenario.calls.profile, 0);
    assert.equal(scenario.calls.admin, 0);
    assert.equal(scenario.calls.catalog, 0);
    assert.equal(scenario.calls.visibility, 0);
    assert.equal(scenario.calls.storage, 0);
    assert.equal(scenario.calls.head, 0);
    assert.equal(scenario.calls.presign, 0);
  }
  assert.equal(cases[0].calls.getUser, 0);
  assert.equal(cases[1].calls.getUser, 0);
  assert.equal(cases[2].calls.getUser, 0);
  assert.equal(cases[3].calls.getUser, 1);
});

test("helper bearer real conserva null cuando falta configuración Supabase", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    assert.equal(getSupabaseEnv().isConfigured, false);

    const source = await readFile(join(process.cwd(), "lib", "auth", "request-client.ts"), "utf8");
    assert.match(source, /createBearerAuthenticatedClient/);
    assert.match(source, /const env = getSupabaseEnv\(\)/);
    assert.match(source, /!env\.isConfigured \|\| !env\.url \|\| !env\.anonKey\) return null/);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnonKey;
  }
});

test("getUser que responde rechazando o sin usuario conserva 401", async () => {
  const cases = [
    createHarness({ user: null, userError: new Error("normal auth rejection") }),
    createHarness({ user: null, userError: null }),
  ];

  for (const scenario of cases) {
    const result = await scenario.resolve();
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, {
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Necesitas una sesión válida.",
    });
    assert.equal(scenario.calls.getUser, 1);
    assert.equal(scenario.calls.profile, 0);
    assert.equal(scenario.calls.admin, 0);
    assert.equal(scenario.calls.catalog, 0);
    assert.equal(scenario.calls.storage, 0);
  }
});

test("perfil conserva 403/503 y ambos fallan antes de catálogo/R2", async () => {
  const inactive = createHarness({ activeProfile: false });
  assert.equal((await inactive.resolve()).status, 403);
  assert.equal(inactive.calls.admin, 0);

  const profileFailure = createHarness({ profileError: "private detail" });
  const failed = await profileFailure.resolve();
  assert.equal(failed.status, 503);
  assert.doesNotMatch(JSON.stringify(failed.body), /private detail/);
  assert.equal(profileFailure.calls.admin, 0);
  assert.equal(inactive.calls.catalog, 0);
  assert.equal(profileFailure.calls.catalog, 0);
  assert.equal(inactive.calls.storage, 0);
  assert.equal(profileFailure.calls.storage, 0);
});

test("packId inválido falla antes de auth y catálogo no configurado/fallido produce 503", async () => {
  const invalid = createHarness();
  assert.equal((await invalid.resolve(null, "../pack")).status, 400);
  assert.equal(invalid.calls.bearer, 0);

  const unconfigured = createHarness({ adminConfigured: false });
  const unconfiguredResult = await unconfigured.resolve();
  assert.equal(unconfiguredResult.status, 503);
  assert.equal((unconfiguredResult.body as { code?: string }).code, "PACK_CATALOG_NOT_CONFIGURED");
  assert.equal(unconfigured.calls.catalog, 0);
  assert.equal(unconfigured.calls.storage, 0);

  const throwingAdmin = createHarness({ throwAdminFactory: true });
  const throwingAdminResult = await throwingAdmin.resolve();
  assert.equal(throwingAdminResult.status, 503);
  assert.equal((throwingAdminResult.body as { code?: string }).code, "PACK_CATALOG_NOT_CONFIGURED");
  assert.doesNotMatch(JSON.stringify(throwingAdminResult.body), /private|service role|stack|secret/i);
  assert.equal(throwingAdmin.calls.catalog, 0);
  assert.equal(throwingAdmin.calls.storage, 0);

  const failed = createHarness({ catalogError: new Error("provider secret") });
  const result = await failed.resolve();
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify(result.body), /provider secret/);
  assert.equal(failed.calls.storage, 0);
});

test("missing/draft/disabled/semana secreta convergen a 404 indistinguible y cero R2", async () => {
  const scenarios = [
    createHarness({ catalog: null }),
    createHarness({ catalog: publishedPack({ status: "draft", published_at: null }) }),
    createHarness({ catalog: publishedPack({ status: "disabled" }) }),
    createHarness({ visibility: { ok: true, available: false } }),
  ];

  for (const scenario of scenarios) {
    const result = await scenario.resolve();
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, {
      ok: false,
      code: "PACK_NOT_AVAILABLE",
      error: "Este pack no está disponible.",
    });
    assert.doesNotMatch(JSON.stringify(result.body), /week|object|sha256|size|draft|disabled|secret/i);
    assert.equal(scenario.calls.storage, 0);
    assert.equal(scenario.calls.head, 0);
  }
});

test("fila publicada inconsistente falla 503 y nunca alcanza R2", async () => {
  const scenario = createHarness({ catalog: publishedPack({ object_key: "packs/arbitrary.zip" }) });
  const result = await scenario.resolve();
  assert.equal(result.status, 503);
  assert.equal(scenario.calls.visibility, 0);
  assert.equal(scenario.calls.storage, 0);
  assert.equal(scenario.calls.presign, 0);
});

test("membership no forma parte del resolver ni de sus dependencias", async () => {
  const scenario = createHarness();
  assert.equal((await scenario.resolve()).status, 200);
  assert.equal(scenario.calls.membership, 0);
  const source = await readFile(join(process.cwd(), "lib", "api", "launcher-pack-download.ts"), "utf8");
  assert.doesNotMatch(source, /season_memberships|membership/i);
});

test("happy path conserva el orden completo, TTL y descriptor exacto", async () => {
  const scenario = createHarness();
  const result = await scenario.resolve();
  assert.equal(result.status, 200);
  assert.deepEqual(scenario.operationOrder, [
    "bearer-client",
    "get-claims",
    "get-user",
    "profile",
    "admin-client",
    "catalog",
    "visibility",
    "storage",
    "head",
    "presign",
  ]);
  assert.deepEqual(result.body, {
    version: 1,
    packId: PACK_ID,
    artifact: { sizeBytes: 8, sha256: SHA256, downloadUrl: DOWNLOAD_URL },
  });
});

test("recovery Bearer falla antes de perfil, service role y R2", async () => {
  const scenario = createHarness({
    claims: {
      role: "authenticated",
      sub: "player-1",
      amr: [
        { method: "recovery", timestamp: 1 },
        { method: "token_refresh", timestamp: 2 },
      ],
    },
  });

  const result = await scenario.resolve();
  assert.equal(result.status, 401);
  assert.deepEqual(scenario.operationOrder, ["bearer-client", "get-claims"]);
  assert.equal(scenario.calls.getUser, 0);
  assert.equal(scenario.calls.profile, 0);
  assert.equal(scenario.calls.admin, 0);
  assert.equal(scenario.calls.storage, 0);
  assert.equal(scenario.calls.catalog, 0);
});

test("HEAD precede al presign, valida tamaño y clasifica ausencia del objeto", async () => {
  const missing = createHarness({ head: { ok: false, reason: "not-found" } });
  assert.equal((await missing.resolve()).status, 404);
  assert.equal(missing.calls.presign, 0);

  const unavailable = createHarness({ head: { ok: false, reason: "unavailable" } });
  assert.equal((await unavailable.resolve()).status, 503);
  assert.equal(unavailable.calls.presign, 0);

  for (const contentLength of [null, 7, 9, Number.NaN]) {
    const mismatch = createHarness({ head: { ok: true, contentLength } });
    assert.equal((await mismatch.resolve()).status, 503, String(contentLength));
    assert.equal(mismatch.calls.presign, 0);
  }

  const success = createHarness();
  assert.equal((await success.resolve()).status, 200);
  assert.equal(success.calls.head, 1);
  assert.equal(success.calls.presign, 1);
  assert.deepEqual(success.storageOrder, ["head", "presign"]);
});

test("presign falla cerrado, exige HTTPS segura y produce body 200 exacto", async () => {
  const failed = createHarness({ presign: { ok: false, reason: "unavailable" } });
  assert.equal((await failed.resolve()).status, 503);

  for (const url of [
    "http://packs.example/object.zip?sig=x",
    "https://user:pass@packs.example/object.zip?sig=x",
    "https://localhost/object.zip?sig=x",
    "https://packs.localhost/object.zip?sig=x",
    "https://127.12.0.4/object.zip?sig=x",
    "https://0.0.0.0/object.zip?sig=x",
    "https://packs.example/object.zip?sig=x#fragment",
  ]) {
    const invalid = createHarness({ presign: { ok: true, url } });
    assert.equal((await invalid.resolve()).status, 503, url);
  }

  const success = await createHarness().resolve();
  assert.equal(success.status, 200);
  assert.deepEqual(success.body, {
    version: 1,
    packId: PACK_ID,
    artifact: { sizeBytes: 8, sha256: SHA256, downloadUrl: DOWNLOAD_URL },
  });
});

test("config R2 valida cinco env, bucket y jurisdicciones sin exponer credenciales", () => {
  const valid = {
    HSL_R2_ACCOUNT_ID: "account-token-1",
    HSL_R2_BUCKET: "hsl-packs-private",
    HSL_R2_ACCESS_KEY_ID: "real-access-id",
    HSL_R2_SECRET_ACCESS_KEY: "real-secret-key",
    HSL_R2_JURISDICTION: "default",
  };
  const status = getR2PackStorageConfiguration(valid);
  assert.equal(status.available, true);
  assert.equal(status.endpoint, "https://account-token-1.r2.cloudflarestorage.com");
  assert.doesNotMatch(JSON.stringify(status), /real-access-id|real-secret-key/);
  assert.ok(createR2PackStorage(valid));

  assert.equal(buildR2Endpoint("account", "eu"), "https://account.eu.r2.cloudflarestorage.com");
  assert.equal(buildR2Endpoint("account", "fedramp"), "https://account.fedramp.r2.cloudflarestorage.com");
  assert.ok(R2_HEAD_TIMEOUT_MS >= 5_000 && R2_HEAD_TIMEOUT_MS <= 10_000);

  for (const key of Object.keys(valid)) {
    const missing = { ...valid, [key]: "" };
    assert.equal(getR2PackStorageConfiguration(missing).available, false, key);
    assert.equal(createR2PackStorage(missing), null, key);
  }
  for (const bucket of ["ab", "A-bucket", "-bucket", "bucket-", "bucket_name", "a".repeat(64)]) {
    assert.equal(getR2PackStorageConfiguration({ ...valid, HSL_R2_BUCKET: bucket }).available, false, bucket);
  }
  for (const jurisdiction of ["us", "EU", "", "default.example"] ) {
    assert.equal(getR2PackStorageConfiguration({ ...valid, HSL_R2_JURISDICTION: jurisdiction }).available, false, jurisdiction);
  }
  for (const accountId of ["bad/id", "bad.id", "bad:id", "bad@id", "bad id", "-bad", "bad-"]) {
    assert.equal(getR2PackStorageConfiguration({ ...valid, HSL_R2_ACCOUNT_ID: accountId }).available, false, accountId);
  }
});

test("errores HEAD distinguen sólo objeto ausente del resto de infraestructura", () => {
  for (const error of [{ name: "NoSuchKey" }, { name: "NotFound" }, { code: "no_such_key" }]) {
    assert.equal(classifyR2HeadError(error), "not-found");
  }
  for (const error of [
    { name: "AccessDenied" },
    { name: "SignatureDoesNotMatch" },
    { name: "NoSuchBucket" },
    { name: "AbortError" },
    new Error("network timeout"),
  ]) {
    assert.equal(classifyR2HeadError(error), "unavailable");
  }
});

test("migración 0031 fija catálogo privado, lifecycle e invariantes SQL", async () => {
  const migration = await readFile(join(process.cwd(), "supabase", "migrations", "0031_launcher_packs.sql"), "utf8");
  assert.match(migration, /create table public\.launcher_packs/);
  assert.match(migration, /week_id uuid not null references public\.weeks\(id\) on delete restrict/);
  assert.match(migration, /object_key text generated always as[\s\S]*stored/);
  assert.match(migration, /packs\/v1\/[\s\S]*\.hslpack\.zip/);
  assert.match(migration, /size_bytes > 0 and size_bytes <= 1073741824/);
  assert.match(migration, /sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /where status = 'published'/);
  assert.match(migration, /new\.published_at := now\(\)/);
  assert.match(migration, /old\.status = 'draft'[\s\S]*new\.status not in \('draft', 'published'\)/);
  assert.match(migration, /new\.status not in \('published', 'disabled'\)/);
  assert.match(migration, /published launcher pack identity and bytes are immutable/);
  assert.match(migration, /old\.published_at is not null[\s\S]*cannot be deleted/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /launcher_packs_admin_all[\s\S]*public\.is_admin\(\)/);
  assert.doesNotMatch(migration, /authenticated[\s\S]*for select[\s\S]*using \(true\)/i);
});

test("preflight 0031 es sólo lectura y detecta prerequisites/drift", async () => {
  const preflight = await readFile(join(process.cwd(), "supabase", "preflight", "0031_launcher_packs.sql"), "utf8");
  const executable = preflight.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /\b(create|alter|drop|insert|update|delete|grant|revoke|truncate)\b/i);
  assert.match(preflight, /public\.weeks/);
  assert.match(preflight, /udt_name/);
  assert.match(preflight, /public\.is_admin\(\)/);
  assert.match(preflight, /public\.set_updated_at\(\)/);
  assert.match(preflight, /launcher_pack_id/);
  assert.match(preflight, /launcher_packs/);
  assert.match(preflight, /image_storage_path/);
});

test("route es Node, dinámica, no-store, bearer real y sin cookies/logs/capacidades", async () => {
  const [route, resolver, storage] = await Promise.all([
    readFile(join(process.cwd(), "app", "api", "launcher", "packs", "[packId]", "download", "route.ts"), "utf8"),
    readFile(join(process.cwd(), "lib", "api", "launcher-pack-download.ts"), "utf8"),
    readFile(join(process.cwd(), "lib", "pack-storage", "r2.ts"), "utf8"),
  ]);
  assert.match(route, /runtime = "nodejs"/);
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(route, /Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /createBearerAuthenticatedClient/);
  assert.match(route, /hasActiveProfile/);
  assert.match(route, /createSupabaseAdminClient/);
  assert.match(route, /createR2PackStorage/);
  assert.doesNotMatch(`${route}\n${resolver}`, /request\.cookies|createCookieAuthenticatedClient|season_memberships/);
  assert.doesNotMatch(`${route}\n${resolver}\n${storage}`, /console\.(log|error)|HSL token|X-Amz-Signature/);
  assert.doesNotMatch(storage, /Authorization|Bearer|Supabase|ETag/);
  assert.match(resolver, /resolvePublicWeekVisibility/);
});
