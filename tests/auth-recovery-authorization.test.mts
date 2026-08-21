import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  classifyVerifiedSessionClaims,
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
  const calls: Array<{ name: string }> = [];
  const auth: VerifiableAuthClient = {
    async getClaims() {
      calls.push({ name: "claims" });
      if (options.claimsThrow) throw new Error("unavailable");
      return {
        data: options.claims ? { claims: options.claims } : null,
        error: options.claimsError ?? null,
      };
    },
    async getUser() {
      calls.push({ name: "user" });
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

test("claims verification errors fail closed and absent browser claims are signed out", async () => {
  const rejected = fakeAuth({ claimsError: new Error("invalid JWT") });
  assert.equal((await getVerifiedSessionContext(rejected.auth)).status, "invalid");
  assert.deepEqual(rejected.calls, [{ name: "claims" }]);

  const unavailable = fakeAuth({ claimsThrow: true });
  assert.equal((await getVerifiedSessionContext(unavailable.auth)).status, "unavailable");

  const absent = fakeAuth({ claims: null });
  assert.equal((await getVerifiedSessionContext(absent.auth)).status, "signed-out");
});

test("product identity verifies claims before user and enforces sub coherence", async () => {
  const valid = fakeAuth({
    claims: claims([{ method: "password", timestamp: 1 }]),
    user: { id: "user-1", email: "player@example.test" },
  });
  assert.equal((await getVerifiedProductIdentity(valid.auth)).status, "product");
  assert.deepEqual(valid.calls, [
    { name: "claims" },
    { name: "user" },
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
  assert.equal((await getVerifiedProductIdentity(recovery.auth)).status, "recovery");
  assert.deepEqual(recovery.calls, [{ name: "claims" }]);

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

test("dangerous web elevation remains behind product authorization", async () => {
  const sources = await Promise.all([
    source("app", "api", "profile", "anonymize", "route.ts"),
    source("app", "api", "presence", "web", "route.ts"),
  ]);

  for (const implementation of sources) {
    const authorityIndex = implementation.lastIndexOf("getVerifiedProductIdentity(");
    const elevationIndexes = [
      implementation.indexOf("createSupabaseAdminClient()"),
    ].filter((index) => index >= 0);
    assert.ok(authorityIndex >= 0);
    assert.ok(elevationIndexes.every((index) => index > authorityIndex));
  }
});

test("dual cookie/Bearer mutations classify only the browser branch", async () => {
  const sources = await Promise.all([
    source("app", "api", "submissions", "ingest", "route.ts"),
    source("app", "api", "launcher", "playtime", "ingest", "route.ts"),
  ]);

  for (const implementation of sources) {
    assert.match(implementation, /if \(usesBearer\)[\s\S]*auth\.getUser\(\)/);
    assert.match(implementation, /else \{[\s\S]*getVerifiedProductIdentity\(supabase\.auth\)/);
  }
});
