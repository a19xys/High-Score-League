import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import {
  applyRecoveryAuthHeaders,
  clearRecoveryState,
  createRecoveryCookieAdapter,
  getRecoveryAuthCookieNames,
  getRecoveryAuthCookieOptions,
  isRecoveryAuthCookieName,
  RECOVERY_AUTH_COOKIE_PATH,
  RECOVERY_AUTH_STORAGE_KEY,
} from "../lib/supabase/recovery-cookies.ts";
import { RECOVERY_MAX_AGE_SECONDS, verifyRecoveryOtp } from "../lib/auth/password-recovery.ts";
import { resolveServerSession } from "../lib/auth/server-session.ts";

const source = (...parts: string[]) =>
  readFile(join(process.cwd(), ...parts), "utf8");

test("Recovery uses an isolated Supabase storage namespace supported by the installed SSR package", async () => {
  const [recoveryClient, normalClient, middleware, ssrImplementation] = await Promise.all([
    source("lib", "supabase", "recovery-server.ts"),
    source("lib", "supabase", "server.ts"),
    source("lib", "supabase", "middleware.ts"),
    source("node_modules", "@supabase", "ssr", "src", "createServerClient.ts"),
  ]);

  assert.equal(RECOVERY_AUTH_STORAGE_KEY, "hsl-recovery-auth");
  assert.equal(RECOVERY_AUTH_COOKIE_PATH, "/reset-password");
  assert.match(recoveryClient, /cookieOptions:\s*\{[\s\S]*name: RECOVERY_AUTH_STORAGE_KEY/);
  assert.doesNotMatch(recoveryClient, /auth:\s*\{[\s\S]*storageKey/);
  assert.match(
    ssrImplementation,
    /options\?\.cookieOptions\?\.name[\s\S]*storageKey: options\.cookieOptions\.name/,
  );

  const cookieAdapter = { getAll: () => [], setAll() {} };
  const normal = createServerClient("https://example.supabase.co", "anon", {
    cookies: cookieAdapter,
  });
  const recovery = createServerClient("https://example.supabase.co", "anon", {
    cookieOptions: { name: RECOVERY_AUTH_STORAGE_KEY },
    cookies: cookieAdapter,
  });
  const normalStorageKey = (normal.auth as unknown as { storageKey: string }).storageKey;
  const recoveryStorageKey = (recovery.auth as unknown as { storageKey: string }).storageKey;
  assert.equal(recoveryStorageKey, RECOVERY_AUTH_STORAGE_KEY);
  assert.notEqual(normalStorageKey, recoveryStorageKey);

  assert.doesNotMatch(normalClient, /hsl-recovery-auth|RECOVERY_AUTH_STORAGE_KEY/);
  assert.doesNotMatch(middleware, /hsl-recovery-auth|RECOVERY_AUTH_STORAGE_KEY|RecoveryServerClient/);
});

test("Recovery cookie writes enforce scope, hardening and the real 15-minute lifetime", () => {
  const live = getRecoveryAuthCookieOptions(
    {
      name: "hsl-recovery-auth.0",
      value: "opaque",
      options: { maxAge: 60 * 60 * 24 * 400, path: "/" },
    },
    true,
  );
  assert.equal(live.maxAge, RECOVERY_MAX_AGE_SECONDS);
  assert.equal(live.path, "/reset-password");
  assert.equal(live.httpOnly, true);
  assert.equal(live.sameSite, "lax");
  assert.equal(live.secure, true);

  const expires = new Date(0);
  const deletion = getRecoveryAuthCookieOptions(
    {
      name: "hsl-recovery-auth.0",
      value: "",
      options: { expires, maxAge: 0, path: "/" },
    },
    false,
  );
  assert.equal(deletion.maxAge, 0);
  assert.equal(deletion.expires, expires);
  assert.equal(deletion.path, "/reset-password");
  assert.equal(deletion.httpOnly, true);
  assert.equal(deletion.sameSite, "lax");
  assert.equal(deletion.secure, false);
});

test("Recovery cookie adapter preserves SSR no-cache headers and never revives deletes", () => {
  const writes: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const responseHeaders = new Headers();
  const adapter = createRecoveryCookieAdapter(
    {
      getAll: () => [],
      set(name, value, options) {
        writes.push({ name, value, options });
      },
    },
    responseHeaders,
    true,
  );

  adapter.setAll(
    [
      {
        name: "hsl-recovery-auth.0",
        value: "opaque",
        options: { maxAge: 34_560_000 },
      },
      {
        name: "hsl-recovery-auth.1",
        value: "",
        options: { expires: new Date(0), maxAge: 0 },
      },
    ],
    {
      "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      Expires: "0",
      Pragma: "no-cache",
    },
  );

  assert.equal(writes[0].options.maxAge, RECOVERY_MAX_AGE_SECONDS);
  assert.equal(writes[1].options.maxAge, 0);
  assert.equal(writes[0].options.path, RECOVERY_AUTH_COOKIE_PATH);
  assert.equal(responseHeaders.get("cache-control"), "private, no-cache, no-store, must-revalidate, max-age=0");
  assert.equal(responseHeaders.get("expires"), "0");
  assert.equal(responseHeaders.get("pragma"), "no-cache");

  const targetHeaders = new Headers();
  applyRecoveryAuthHeaders(
    { cookies: { set() {} }, headers: targetHeaders },
    responseHeaders,
  );
  assert.equal(targetHeaders.get("cache-control"), responseHeaders.get("cache-control"));
});

test("Recovery cleanup inventories every existing chunk without touching normal Auth", () => {
  const cookies = [
    { name: "hsl-recovery-auth.0", value: "a" },
    { name: "hsl-recovery-auth.1", value: "b" },
    { name: "sb-project-auth-token", value: "normal" },
    { name: "unrelated", value: "value" },
  ];
  const names = getRecoveryAuthCookieNames(cookies);
  assert.deepEqual(names, [
    "hsl-recovery-auth",
    "hsl-recovery-auth.0",
    "hsl-recovery-auth.1",
  ]);
  assert.equal(isRecoveryAuthCookieName("hsl-recovery-auth.27"), true);
  assert.equal(isRecoveryAuthCookieName("sb-project-auth-token"), false);

  const expired: Array<{ name: string; options: Record<string, unknown> }> = [];
  clearRecoveryState(
    {
      cookies: {
        set(name, _value, options) {
          expired.push({ name, options });
        },
      },
      headers: { set() {} },
    },
    cookies,
    { auth: true, markers: true, staging: true },
  );

  const expiredNames = expired.map(({ name }) => name);
  assert.ok(expiredNames.includes("hsl-recovery-auth"));
  assert.ok(expiredNames.includes("hsl-recovery-auth.0"));
  assert.ok(expiredNames.includes("hsl-recovery-auth.1"));
  assert.ok(!expiredNames.includes("sb-project-auth-token"));
  assert.ok(expired.every(({ options }) => options.maxAge === 0));
  assert.equal(
    expired.find(({ name }) => name === "hsl-recovery-auth.1")?.options.path,
    RECOVERY_AUTH_COOKIE_PATH,
  );
});

test("the literal otp-AMR regression is irrelevant after isolated verification", async () => {
  const calls: unknown[] = [];
  const resultingSession = { amr: [{ method: "otp", timestamp: 1 }] };
  const verified = await verifyRecoveryOtp(
    {
      async verifyOtp(input) {
        calls.push({ input, resultingSession });
        return { error: null };
      },
    },
    "valid-token-hash",
  );
  const verifyRoute = await source("app", "auth", "recovery", "verify", "route.ts");

  assert.equal(verified, true);
  assert.deepEqual(calls[0], {
    input: { token_hash: "valid-token-hash", type: "recovery" },
    resultingSession,
  });
  assert.match(verifyRoute, /createSupabaseRecoveryServerClient/);
  assert.match(verifyRoute, /verified[\s\S]*redirect\(request, "\/reset-password"\)/);
  assert.doesNotMatch(verifyRoute, /getClaims|\.amr|AMR|getVerifiedSession|signOut/);
});

test("reset, completion and cancellation use only isolated Recovery Auth", async () => {
  const [page, complete, cancel, preVerifyCancel, invalidate] = await Promise.all([
    source("app", "reset-password", "page.tsx"),
    source("app", "reset-password", "complete", "route.ts"),
    source("app", "reset-password", "cancel", "route.ts"),
    source("app", "auth", "recovery", "cancel", "route.ts"),
    source("app", "reset-password", "invalidate", "route.ts"),
  ]);

  assert.match(page, /createSupabaseRecoveryServerClient/);
  assert.match(page, /client\.auth\.getUser\(\)/);
  assert.match(page, /isAuthorizedRecoverySession\([\s\S]*hasRecoveryUser/);
  assert.doesNotMatch(page, /createSupabaseServerClient|getClaims|\.amr/);

  assert.match(complete, /createSupabaseRecoveryServerClient/);
  assert.match(complete, /client\.auth\.getUser\(\)/);
  assert.match(complete, /auth: recovery\.client\.auth/);
  assert.match(complete, /retryGlobalRecoverySignOut\(recovery\.client\.auth\)/);
  assert.match(complete, /clearRecoveryState/);
  assert.doesNotMatch(complete, /createSupabaseServerClient|getClaims|\.amr/);

  assert.match(cancel, /createSupabaseRecoveryServerClient/);
  assert.match(cancel, /client\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(cancel, /clearRecoveryState/);
  assert.doesNotMatch(cancel, /scope: "global"|createSupabaseServerClient/);

  assert.match(preVerifyCancel, /clearRecoveryState/);
  assert.match(preVerifyCancel, /\/reset-password\/cancel\?preverify=1/);
  assert.doesNotMatch(preVerifyCancel, /createSupabase|\.auth\.|signOut/);

  assert.match(invalidate, /export async function POST/);
  assert.match(invalidate, /clearRecoveryState\([\s\S]*auth: true/);
  assert.doesNotMatch(invalidate, /createSupabase|\.auth\.|signOut/);
});

test("normal HSL session authority is getUser-only and centralized in RootLayout", async () => {
  let calls = 0;
  const signedIn = await resolveServerSession({
    async getUser() {
      calls += 1;
      return {
        data: { user: { id: "normal-user", email: "player@example.test" } },
        error: null,
      };
    },
  });
  assert.deepEqual(signedIn, {
    status: "signed-in",
    userId: "normal-user",
    email: "player@example.test",
  });
  assert.equal(calls, 1);
  assert.deepEqual(await resolveServerSession(null), {
    status: "not-configured",
    userId: null,
    email: null,
  });

  const [serverSession, layout, nav] = await Promise.all([
    source("lib", "auth", "server-session.ts"),
    source("app", "layout.tsx"),
    source("components", "site-nav.tsx"),
  ]);
  assert.match(serverSession, /auth\.getUser\(\)/);
  assert.doesNotMatch(serverSession, /getClaims|recovery|invalid|AMR|\.amr/);
  assert.equal((layout.match(/getServerSession\(\)/g) ?? []).length, 1);
  assert.match(layout, /<SiteNav session=\{session\}/);
  assert.doesNotMatch(nav, /auth\.getUser|getServerSession/);
});

test("all former web and dual Bearer boundaries use getUser with no AMR authority", async () => {
  const paths = [
    ["app", "api", "submissions", "ingest", "route.ts"],
    ["app", "api", "launcher", "playtime", "ingest", "route.ts"],
    ["app", "api", "presence", "web", "route.ts"],
    ["app", "api", "profile", "anonymize", "route.ts"],
    ["app", "api", "chat", "messages", "route.ts"],
    ["app", "api", "home-poll", "vote", "route.ts"],
    ["app", "api", "seasons", "[seasonId]", "join", "route.ts"],
    ["components", "profile", "profile-editor.tsx"],
  ];
  const implementations = await Promise.all(paths.map((parts) => source(...parts)));

  for (const implementation of implementations) {
    assert.match(implementation, /auth\.getUser\(\)/);
    assert.doesNotMatch(implementation, /getClaims|getVerifiedProductIdentity|session-context|\.amr|AMR/);
  }
});
