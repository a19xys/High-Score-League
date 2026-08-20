import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  NEW_PASSWORD_REQUIREMENTS,
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
} from "../lib/auth/validation.ts";
import {
  completePasswordRecovery,
  getRecoveryCookieOptions,
  isAuthorizedRecoverySession,
  isStructurallyValidRecoveryToken,
  RECOVERY_GENERIC_SUCCESS,
  RECOVERY_MAX_AGE_SECONDS,
  RECOVERY_TOKEN_MAX_LENGTH,
  requestPasswordRecovery,
  selectRecoveryToken,
  verifyRecoveryOtp,
} from "../lib/auth/password-recovery.ts";

const source = (...parts: string[]) =>
  readFile(join(process.cwd(), ...parts), "utf8");

test("the canonical new-password policy requires 8 chars, lower, upper and digit", () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(validateNewPassword("Aa123456"), null);
  assert.equal(validateNewPassword("Aa12345"), NEW_PASSWORD_REQUIREMENTS);
  assert.equal(validateNewPassword("aaaaaaaa1"), NEW_PASSWORD_REQUIREMENTS);
  assert.equal(validateNewPassword("AAAAAAAA1"), NEW_PASSWORD_REQUIREMENTS);
  assert.equal(validateNewPassword("Aaaaaaaa"), NEW_PASSWORD_REQUIREMENTS);
  assert.equal(validateNewPassword("Aa12345!"), null);
  assert.equal(validateNewPassword("ÁAa12345"), null);
  assert.equal(validateNewPassword("Aa1 2345"), null);
});

test("register uses new-password policy while login accepts legacy credentials locally", async () => {
  const [login, register] = await Promise.all([
    source("components", "auth", "login-form.tsx"),
    source("components", "auth", "register-form.tsx"),
  ]);

  assert.doesNotMatch(login, /validateNewPassword|validatePassword/);
  assert.match(login, /if \(!password\)/);
  assert.match(login, /signInWithPassword\(\{[\s\S]*email,[\s\S]*password/);
  assert.match(login, /href="\/forgot-password"/);
  assert.match(register, /validateNewPassword\(password\)/);
  assert.match(register, /Los caracteres especiales son opcionales/);
});

test("forgot-password rejects invalid email and unavailable client without requests", async () => {
  let calls = 0;
  const auth = {
    async resetPasswordForEmail() {
      calls += 1;
      return { error: null };
    },
  };

  const invalid = await requestPasswordRecovery({
    auth,
    email: "not-an-email",
    origin: "https://hsl.example",
  });
  const unavailable = await requestPasswordRecovery({
    auth: null,
    email: "player@example.com",
    origin: "https://hsl.example",
  });

  assert.equal(invalid.kind, "invalid-email");
  assert.equal(unavailable.kind, "unavailable");
  assert.equal(calls, 0);
});

test("forgot-password performs one request with a fixed same-origin staging redirect", async () => {
  const calls: Array<{
    email: string;
    options: { redirectTo: string };
  }> = [];
  const result = await requestPasswordRecovery({
    auth: {
      async resetPasswordForEmail(email, options) {
        calls.push({ email, options });
        return { error: null };
      },
    },
    email: " player@example.com ",
    origin: "https://hsl.example",
  });

  assert.deepEqual(result, {
    kind: "accepted",
    message: RECOVERY_GENERIC_SUCCESS,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "player@example.com");
  assert.equal(
    calls[0].options.redirectTo,
    "https://hsl.example/auth/recovery/start",
  );
});

test("forgot-password keeps registered and undisclosed addresses indistinguishable", async () => {
  const existing = await requestPasswordRecovery({
    auth: {
      async resetPasswordForEmail() {
        return { error: null };
      },
    },
    email: "existing@example.com",
    origin: "https://hsl.example",
  });
  const undisclosed = await requestPasswordRecovery({
    auth: {
      async resetPasswordForEmail() {
        return {
          error: { message: "User not found", status: 400 },
        };
      },
    },
    email: "missing@example.com",
    origin: "https://hsl.example",
  });

  assert.deepEqual(existing, undisclosed);
  assert.deepEqual(undisclosed, {
    kind: "accepted",
    message: RECOVERY_GENERIC_SUCCESS,
  });
});

test("forgot-password safely classifies rate limits and blocks double submit in UI", async () => {
  const [result, form] = await Promise.all([
    requestPasswordRecovery({
      auth: {
        async resetPasswordForEmail() {
          return { error: { code: "over_email_send_rate_limit", status: 429 } };
        },
      },
      email: "player@example.com",
      origin: "https://hsl.example",
    }),
    source("components", "auth", "forgot-password-form.tsx"),
  ]);

  assert.equal(result.kind, "rate-limited");
  assert.match(form, /if \(isSubmitting\)[\s\S]*return/);
  assert.match(form, /disabled=\{isSubmitting\}/);
  assert.doesNotMatch(form, /auth\.users|profiles|rpc\(|admin\./i);
});

test("recovery token staging accepts one bounded value and uses hardened cookies", () => {
  assert.equal(isStructurallyValidRecoveryToken("abc"), true);
  assert.equal(selectRecoveryToken(["abc"]), "abc");
  assert.equal(selectRecoveryToken([]), null);
  assert.equal(selectRecoveryToken(["abc", "def"]), null);
  assert.equal(selectRecoveryToken([" abc"]), null);
  assert.equal(selectRecoveryToken(["x".repeat(RECOVERY_TOKEN_MAX_LENGTH + 1)]), null);

  const options = getRecoveryCookieOptions("/auth/recovery");
  assert.equal(RECOVERY_MAX_AGE_SECONDS, 15 * 60);
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/auth/recovery");
});

test("the initial GET only stages and redirects; it cannot consume recovery", async () => {
  const route = await source(
    "app",
    "auth",
    "recovery",
    "start",
    "route.ts",
  );

  assert.match(route, /export async function GET/);
  assert.match(route, /searchParams\.getAll\("token_hash"\)/);
  assert.match(route, /response\.cookies\.set\(RECOVERY_STAGING_COOKIE/);
  assert.match(route, /new URL\("\/auth\/recovery", request\.url\)/);
  assert.doesNotMatch(route, /verifyOtp|updateUser|signOut|createSupabase/i);
  assert.doesNotMatch(route, /localStorage|sessionStorage|console\./);
});

test("recovery OTP verification is POST-only, typed as recovery and fails closed", async () => {
  const calls: unknown[] = [];
  const valid = await verifyRecoveryOtp(
    {
      async verifyOtp(input) {
        calls.push(input);
        return { error: null };
      },
    },
    "abc",
  );
  const invalid = await verifyRecoveryOtp(
    {
      async verifyOtp(input) {
        calls.push(input);
        return { error: new Error("expired") };
      },
    },
    "def",
  );

  assert.equal(valid, true);
  assert.equal(invalid, false);
  assert.deepEqual(calls, [
    { token_hash: "abc", type: "recovery" },
    { token_hash: "def", type: "recovery" },
  ]);

  const route = await source(
    "app",
    "auth",
    "recovery",
    "verify",
    "route.ts",
  );
  assert.match(route, /export async function POST/);
  assert.match(route, /expireAllRecoveryState\(response\)/);
  assert.match(route, /RECOVERY_AUTHORIZED_COOKIE/);
  assert.match(route, /redirect\(request, "\/reset-password"\)/);
  assert.doesNotMatch(route, /service.?role|auth\.admin|updateUser|signOut/i);
});

test("reset-password guard requires both a recovery marker and authenticated user", () => {
  assert.equal(isAuthorizedRecoverySession(undefined, false), false);
  assert.equal(isAuthorizedRecoverySession("1", false), false);
  assert.equal(isAuthorizedRecoverySession(undefined, true), false);
  assert.equal(isAuthorizedRecoverySession("1", true), true);
});

function completionAuth(options?: {
  signOutError?: unknown;
  updateError?: unknown;
}) {
  const calls: Array<{ name: string; value: unknown }> = [];
  return {
    auth: {
      async signOut(value: { scope: "global" }) {
        calls.push({ name: "signOut", value });
        return { error: options?.signOutError ?? null };
      },
      async updateUser(value: { password: string }) {
        calls.push({ name: "updateUser", value });
        return { error: options?.updateError ?? null };
      },
    },
    calls,
  };
}

test("server completion rejects every invalid password before updateUser", async () => {
  for (const password of ["Aa12345", "aaaaaaaa1", "AAAAAAAA1", "Aaaaaaaa"]) {
    const fake = completionAuth();
    const result = await completePasswordRecovery({
      auth: fake.auth,
      confirmation: password,
      password,
    });
    assert.equal(result.kind, "policy-error");
    assert.equal(fake.calls.length, 0);
  }

  const mismatch = completionAuth();
  const result = await completePasswordRecovery({
    auth: mismatch.auth,
    confirmation: "Aa123457",
    password: "Aa123456",
  });
  assert.equal(result.kind, "mismatch");
  assert.equal(mismatch.calls.length, 0);
});

test("successful server completion updates once then signs out globally once", async () => {
  const fake = completionAuth();
  const result = await completePasswordRecovery({
    auth: fake.auth,
    confirmation: "Aa123456",
    password: "Aa123456",
  });

  assert.equal(result.kind, "success");
  assert.deepEqual(fake.calls, [
    { name: "updateUser", value: { password: "Aa123456" } },
    { name: "signOut", value: { scope: "global" } },
  ]);
});

test("update failure skips signout; global signout failure remains incomplete", async () => {
  const updateFailure = completionAuth({ updateError: new Error("update") });
  const updateResult = await completePasswordRecovery({
    auth: updateFailure.auth,
    confirmation: "Aa123456",
    password: "Aa123456",
  });
  assert.equal(updateResult.kind, "update-error");
  assert.deepEqual(updateFailure.calls, [
    { name: "updateUser", value: { password: "Aa123456" } },
  ]);

  const logoutFailure = completionAuth({ signOutError: new Error("logout") });
  const logoutResult = await completePasswordRecovery({
    auth: logoutFailure.auth,
    confirmation: "Aa123456",
    password: "Aa123456",
  });
  assert.equal(logoutResult.kind, "logout-error");
  assert.deepEqual(logoutFailure.calls[1], {
    name: "signOut",
    value: { scope: "global" },
  });
});

test("completion route retains a marker for safe global-signout retry", async () => {
  const [route, page, form] = await Promise.all([
    source("app", "reset-password", "complete", "route.ts"),
    source("app", "reset-password", "page.tsx"),
    source("components", "auth", "reset-password-form.tsx"),
  ]);

  assert.match(route, /completePasswordRecovery/);
  assert.match(route, /result\.kind === "logout-error"[\s\S]*retainLogoutRetryState/);
  assert.match(route, /retryGlobalRecoverySignOut/);
  assert.match(route, /\/login\?passwordReset=success/);
  assert.match(page, /isAuthorizedRecoverySession/);
  assert.match(page, /supabase\.auth\.getUser\(\)/);
  assert.match(form, /autoComplete="new-password"/);
  assert.equal((form.match(/autoComplete="new-password"/g) ?? []).length, 2);
});

test("recovery implementation has no parallel Auth authority or secret storage", async () => {
  const sources = await Promise.all([
    source("lib", "auth", "password-recovery.ts"),
    source("app", "auth", "recovery", "start", "route.ts"),
    source("app", "auth", "recovery", "verify", "route.ts"),
    source("app", "reset-password", "complete", "route.ts"),
  ]);
  const implementation = sources.join("\n");

  assert.doesNotMatch(
    implementation,
    /createSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY|auth\.admin|updateUserById|localStorage|sessionStorage/,
  );
  assert.doesNotMatch(implementation, /console\.(?:log|error|warn)/);
});
