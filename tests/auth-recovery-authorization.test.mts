import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  classifyVerifiedSessionClaims,
  extractBearerAccessToken,
  getVerifiedProductIdentity,
  getVerifiedSessionContext,
  getVerifiedSessionIdentity,
  type VerifiableAuthClient,
} from "../lib/auth/session-context.ts";
import { resolveServerSession } from "../lib/auth/server-session.ts";

function claims(methods?: unknown) {
  return {
    role: "authenticated",
    sub: "user-1",
    ...(methods === undefined ? {} : { amr: methods }),
  };
}

function fakeAuth(options: {
  claims?: unknown;
  claimsError?: unknown;
  claimsThrow?: boolean;
  user?: { id: string; email?: string } | null;
  userError?: unknown;
}) {
  const calls: Array<{ name: string; token?: string }> = [];
  const auth: VerifiableAuthClient = {
    async getClaims(token?: string) {
      calls.push({ name: "claims", token });
      if (options.claimsThrow) throw new Error("unavailable");
      return {
        data: options.claims ? { claims: options.claims } : null,
        error: options.claimsError ?? null,
      };
    },
    async getUser(token?: string) {
      calls.push({ name: "user", token });
      return {
        data: { user: options.user === undefined ? { id: "user-1" } : options.user },
        error: options.userError ?? null,
      };
    },
  };
  return { auth, calls };
}

async function source(...parts: string[]) {
  return readFile(join(process.cwd(), ...parts), "utf8");
}

test("verified AMR classifies password, oauth and legacy sessions as product", () => {
  assert.deepEqual(
    classifyVerifiedSessionClaims(claims([{ method: "password", timestamp: 1 }])),
    { status: "product", userId: "user-1" },
  );
  assert.deepEqual(
    classifyVerifiedSessionClaims(claims([{ method: "oauth", timestamp: 1 }])),
    { status: "product", userId: "user-1" },
  );
  assert.deepEqual(classifyVerifiedSessionClaims(claims()), {
    status: "product",
    userId: "user-1",
  });
});

test("recovery remains recovery after token_refresh", () => {
  const initial = classifyVerifiedSessionClaims(
    claims([{ method: "recovery", timestamp: 1 }]),
  );
  const refreshed = classifyVerifiedSessionClaims(
    claims([
      { method: "recovery", timestamp: 1 },
      { method: "token_refresh", timestamp: 2 },
    ]),
  );

  assert.equal(initial.status, "recovery");
  assert.equal(refreshed.status, "recovery");
});

test("present malformed AMR and untrusted claims fail closed", () => {
  for (const value of [
    null,
    {},
    "recovery",
    [null],
    ["password", { method: "recovery", timestamp: 1 }],
    [{ method: "password" }],
    [{ method: "", timestamp: 1 }],
    [{ method: " recovery ", timestamp: 1 }],
    [" "],
    [{ method: "password", timestamp: Number.NaN }],
  ]) {
    assert.equal(classifyVerifiedSessionClaims(claims(value)).status, "invalid");
  }

  assert.equal(classifyVerifiedSessionClaims({ role: "anon", sub: "user-1" }).status, "invalid");
  assert.equal(classifyVerifiedSessionClaims({ role: "authenticated" }).status, "invalid");
});

test("claims verification errors fail closed and explicit Bearer absence is invalid", async () => {
  const rejected = fakeAuth({ claimsError: new Error("invalid JWT") });
  assert.equal((await getVerifiedSessionContext(rejected.auth, "token")).status, "invalid");
  assert.deepEqual(rejected.calls, [{ name: "claims", token: "token" }]);

  const unavailable = fakeAuth({ claimsThrow: true });
  assert.equal((await getVerifiedSessionContext(unavailable.auth)).status, "unavailable");

  const absent = fakeAuth({ claims: null });
  assert.equal((await getVerifiedSessionContext(absent.auth)).status, "signed-out");
  assert.equal((await getVerifiedSessionContext(absent.auth, "token")).status, "invalid");
});

test("product identity verifies claims before user and enforces sub coherence", async () => {
  const valid = fakeAuth({
    claims: claims([{ method: "password", timestamp: 1 }]),
    user: { id: "user-1", email: "player@example.test" },
  });
  assert.equal((await getVerifiedProductIdentity(valid.auth, "bearer-token")).status, "product");
  assert.deepEqual(valid.calls, [
    { name: "claims", token: "bearer-token" },
    { name: "user", token: "bearer-token" },
  ]);

  const mismatch = fakeAuth({
    claims: claims([{ method: "password", timestamp: 1 }]),
    user: { id: "different-user" },
  });
  assert.equal((await getVerifiedProductIdentity(mismatch.auth)).status, "invalid");
});

test("product boundaries reject recovery before requesting user data", async () => {
  const recovery = fakeAuth({
    claims: claims([{ method: "recovery", timestamp: 1 }]),
  });
  assert.equal((await getVerifiedProductIdentity(recovery.auth, "recovery-token")).status, "recovery");
  assert.deepEqual(recovery.calls, [{ name: "claims", token: "recovery-token" }]);

  const recoveryWorkflow = fakeAuth({
    claims: claims([{ method: "recovery", timestamp: 1 }]),
    user: { id: "user-1" },
  });
  assert.equal((await getVerifiedSessionIdentity(recoveryWorkflow.auth)).status, "recovery");
  assert.deepEqual(recoveryWorkflow.calls.map((call) => call.name), ["claims", "user"]);
});

test("server session exposes only normal credentials as signed-in", async () => {
  const product = fakeAuth({
    claims: claims([{ method: "password", timestamp: 1 }]),
    user: { id: "user-1", email: "player@example.test" },
  });
  assert.deepEqual(await resolveServerSession(product.auth), {
    status: "signed-in",
    userId: "user-1",
    email: "player@example.test",
  });

  const recovery = fakeAuth({
    claims: claims([{ method: "recovery", timestamp: 1 }]),
  });
  assert.deepEqual(await resolveServerSession(recovery.auth), {
    status: "recovery",
    userId: null,
    email: null,
  });
  assert.deepEqual(recovery.calls.map((call) => call.name), ["claims"]);
});

test("Bearer parser accepts one strict token and rejects ambiguous headers", () => {
  assert.equal(extractBearerAccessToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(extractBearerAccessToken("bearer token"), "token");
  for (const value of [null, "", "Bearer", "Bearer token extra", "Bearer a,b", "Basic token"]) {
    assert.equal(extractBearerAccessToken(value), null);
  }
});

test("Recovery-safe layout does not activate private navigation or Presence", async () => {
  const [layout, nav, profile, serverSession] = await Promise.all([
    source("app", "layout.tsx"),
    source("components", "site-nav.tsx"),
    source("app", "profile", "page.tsx"),
    source("lib", "auth", "session.ts"),
  ]);

  assert.match(layout, /session\.status === "signed-in"/);
  assert.match(layout, /<SiteNav session=\{session\}/);
  assert.match(nav, /session\.status !== "signed-in"/);
  assert.doesNotMatch(nav, /auth\.getUser/);
  assert.match(profile, /getVerifiedProductIdentity/);
  assert.match(serverSession, /return session\.status === "signed-in"/);
});

test("expired marker leaves a POST-only local exit from Recovery", async () => {
  const [page, cancel, complete] = await Promise.all([
    source("app", "reset-password", "page.tsx"),
    source("app", "reset-password", "cancel", "route.ts"),
    source("app", "reset-password", "complete", "route.ts"),
  ]);

  assert.match(page, /identity\.status === "recovery"[\s\S]*method="post"/);
  assert.match(page, /action="\/reset-password\/cancel"/);
  assert.match(cancel, /export async function POST/);
  assert.match(cancel, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(cancel, /scope: "global"/);
  assert.match(complete, /getVerifiedSessionIdentity/);
  assert.ok(
    complete.indexOf('identity.status !== "recovery"') <
      complete.indexOf("completePasswordRecovery({"),
  );
});

test("SQL migration derives RLS coverage and guards Storage plus elevated RPCs", async () => {
  const [migration, preflight] = await Promise.all([
    source("supabase", "migrations", "0033_recovery_session_authorization.sql"),
    source("supabase", "preflight", "0033_recovery_session_authorization.sql"),
  ]);

  assert.match(migration, /create or replace function public\.has_product_session\(\)/i);
  assert.match(migration, /auth\.uid\(\).*auth\.role\(\)/s);
  assert.match(migration, /request_claims -> 'amr'/);
  assert.match(migration, /method_name = 'recovery'/);
  assert.match(migration, /create policy hsl_product_session_barrier[\s\S]*as restrictive[\s\S]*for all[\s\S]*has_product_session/i);
  assert.match(migration, /has_table_privilege\('authenticated', class\.oid/);
  assert.match(migration, /on storage\.objects[\s\S]*hsl-public-media[\s\S]*has_product_session/i);
  assert.match(migration, /create or replace function public\.has_active_profile\(\)[\s\S]*has_product_session/i);
  assert.match(migration, /create or replace function public\.is_admin\(\)[\s\S]*has_product_session/i);
  assert.match(migration, /ingest_play_time_event[\s\S]*product_session_required/i);
  assert.match(migration, /has_function_privilege\('authenticated', proc\.oid, 'EXECUTE'\)/);

  assert.match(preflight, /authenticated_relations/);
  assert.match(preflight, /storage\.buckets/);
  assert.match(preflight, /procedure\.prosecdef|proc\.prosecdef/);
  assert.match(preflight, /authenticated_security_definer_without_product_guard/);
  const executablePreflight = preflight.replace(/^--.*$/gm, "");
  assert.doesNotMatch(
    executablePreflight,
    /^\s*(alter|create|delete|drop|grant|insert|revoke|truncate|update)\b/im,
  );
});

test("service-role and R2 factories remain behind product authorization", async () => {
  const sources = await Promise.all([
    source("app", "api", "profile", "anonymize", "route.ts"),
    source("app", "api", "presence", "web", "route.ts"),
    source("app", "api", "players", "[username]", "presence", "route.ts"),
    source("lib", "api", "launcher-pack-download.ts"),
  ]);

  for (const implementation of sources) {
    const authorityIndex = implementation.lastIndexOf("getVerifiedProductIdentity(");
    const elevationIndexes = [
      implementation.indexOf("createSupabaseAdminClient()"),
      implementation.indexOf("dependencies.createAdminClient()"),
      implementation.indexOf("dependencies.createStorage()"),
    ].filter((index) => index >= 0);
    assert.ok(authorityIndex >= 0);
    assert.ok(elevationIndexes.every((index) => index > authorityIndex));
  }
});
