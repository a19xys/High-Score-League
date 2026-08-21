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
  RECOVERY_RATE_LIMIT_MESSAGE,
  RECOVERY_SAME_PASSWORD_MESSAGE,
  RECOVERY_TOKEN_MAX_LENGTH,
  RECOVERY_UNAVAILABLE_MESSAGE,
  RECOVERY_WEAK_PASSWORD_MESSAGE,
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

test("register applies the new-password policy while login delegates credential validity to Supabase", async () => {
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
    redirectOrigin: "https://highscoreleague.com",
  });
  const unavailable = await requestPasswordRecovery({
    auth: null,
    email: "player@example.com",
    redirectOrigin: "https://highscoreleague.com",
  });

  assert.equal(invalid.kind, "invalid-email");
  assert.equal(unavailable.kind, "unavailable");
  assert.equal(calls, 0);
});

test("forgot-password performs one request with the canonical staging redirect", async () => {
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
    redirectOrigin: "https://highscoreleague.com",
  });

  assert.deepEqual(result, {
    kind: "accepted",
    message: RECOVERY_GENERIC_SUCCESS,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "player@example.com");
  assert.equal(
    calls[0].options.redirectTo,
    "https://highscoreleague.com/auth/recovery/start",
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
    redirectOrigin: "https://highscoreleague.com",
  });
  const undisclosed = await requestPasswordRecovery({
    auth: {
      async resetPasswordForEmail() {
        return {
          error: { code: "user_not_found", status: 400 },
        };
      },
    },
    email: "missing@example.com",
    redirectOrigin: "https://highscoreleague.com",
  });

  assert.deepEqual(existing, undisclosed);
  assert.deepEqual(undisclosed, {
    kind: "accepted",
    message: RECOVERY_GENERIC_SUCCESS,
  });
});

test("forgot-password classifies known rate limits and invalid addresses by semantic code", async () => {
  const cases = [
    {
      error: { code: "over_email_send_rate_limit" },
      expected: {
        kind: "rate-limited",
        message: RECOVERY_RATE_LIMIT_MESSAGE,
      },
    },
    {
      error: { code: "over_request_rate_limit" },
      expected: {
        kind: "rate-limited",
        message: RECOVERY_RATE_LIMIT_MESSAGE,
      },
    },
    {
      error: { status: 429 },
      expected: {
        kind: "rate-limited",
        message: RECOVERY_RATE_LIMIT_MESSAGE,
      },
    },
    {
      error: { code: "email_address_invalid", status: 429 },
      expected: {
        kind: "invalid-email",
        message: "Introduce un email válido.",
      },
    },
  ] as const;

  for (const { error, expected } of cases) {
    const result = await requestPasswordRecovery({
      auth: {
        async resetPasswordForEmail() {
          return { error };
        },
      },
      email: "player@example.com",
      redirectOrigin: "https://highscoreleague.com",
    });

    assert.deepEqual(result, expected);
  }
});

test("forgot-password fails closed for every other non-null error", async () => {
  const errors = [
    { code: "email_address_not_authorized" },
    { code: "email_provider_disabled" },
    { code: "captcha_failed" },
    { code: "validation_failed" },
    { code: "request_timeout" },
    { code: "unexpected_failure" },
    { code: "future_unknown_error", message: "Too many requests", status: 400 },
    { message: "unknown", status: 400 },
    { message: "unknown", status: 422 },
    { message: "unknown", status: 500 },
  ];

  for (const error of errors) {
    const result = await requestPasswordRecovery({
      auth: {
        async resetPasswordForEmail() {
          return { error };
        },
      },
      email: "player@example.com",
      redirectOrigin: "https://highscoreleague.com",
    });

    assert.deepEqual(result, {
      kind: "unavailable",
      message: RECOVERY_UNAVAILABLE_MESSAGE,
    });
  }
});

test("forgot-password uses only a narrow text fallback and sanitizes thrown errors", async () => {
  const fallback = await requestPasswordRecovery({
    auth: {
      async resetPasswordForEmail() {
        return { error: { message: "Too many requests" } };
      },
    },
    email: "player@example.com",
    redirectOrigin: "https://highscoreleague.com",
  });
  const thrown = await requestPasswordRecovery({
    auth: {
      async resetPasswordForEmail() {
        throw new Error("raw transport detail");
      },
    },
    email: "player@example.com",
    redirectOrigin: "https://highscoreleague.com",
  });

  assert.deepEqual(fallback, {
    kind: "rate-limited",
    message: RECOVERY_RATE_LIMIT_MESSAGE,
  });
  assert.deepEqual(thrown, {
    kind: "unavailable",
    message: RECOVERY_UNAVAILABLE_MESSAGE,
  });
});

test("forgot-password blocks double submit in UI without email lookups", async () => {
  const form = await source("components", "auth", "forgot-password-form.tsx");

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
  assert.match(route, /getVerifiedSessionIdentity/);
  assert.match(route, /recoveryIdentity\.status !== "recovery"/);
  assert.match(route, /signOut\(\{ scope: "local" \}\)/);
  assert.match(route, /redirect\(request, "\/reset-password"\)/);
  assert.doesNotMatch(route, /service.?role|auth\.admin|updateUser/i);
});

test("reset-password guard requires both a recovery marker and classified recovery", () => {
  assert.equal(isAuthorizedRecoverySession(undefined, "signed-out"), false);
  assert.equal(isAuthorizedRecoverySession("1", "signed-out"), false);
  assert.equal(isAuthorizedRecoverySession(undefined, "recovery"), false);
  assert.equal(isAuthorizedRecoverySession("1", "product"), false);
  assert.equal(isAuthorizedRecoverySession("1", "recovery"), true);
});

function completionAuth(options?: {
  signOutError?: unknown;
  updateError?: unknown;
  updateThrows?: boolean;
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

        if (options?.updateThrows) {
          throw new Error("raw update detail");
        }

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

test("known password update rejections are actionable and never sign out", async () => {
  const cases = [
    {
      error: { code: "same_password", message: "raw same-password detail" },
      kind: "same-password",
    },
    {
      error: { code: "weak_password", message: "raw policy reasons" },
      kind: "weak-password",
    },
  ] as const;

  for (const { error, kind } of cases) {
    const fake = completionAuth({ updateError: error });
    const result = await completePasswordRecovery({
      auth: fake.auth,
      confirmation: "Aa123456",
      password: "Aa123456",
    });

    assert.equal(result.kind, kind);
    assert.deepEqual(fake.calls, [
      { name: "updateUser", value: { password: "Aa123456" } },
    ]);
  }
});

test("unknown and thrown password update errors remain generic and never sign out", async () => {
  for (const options of [
    { updateError: { code: "unexpected_failure", status: 500 } },
    { updateThrows: true },
  ]) {
    const fake = completionAuth(options);
    const result = await completePasswordRecovery({
      auth: fake.auth,
      confirmation: "Aa123456",
      password: "Aa123456",
    });

    assert.equal(result.kind, "update-error");
    assert.deepEqual(fake.calls, [
      { name: "updateUser", value: { password: "Aa123456" } },
    ]);
  }
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
  const retryBranch = route.slice(
    route.indexOf("if (logoutPending)"),
    route.indexOf("let formData"),
  );
  assert.match(retryBranch, /retryGlobalRecoverySignOut/);
  assert.doesNotMatch(retryBranch, /completePasswordRecovery|updateUser/);
  assert.match(page, /isAuthorizedRecoverySession/);
  assert.match(page, /getVerifiedSessionIdentity/);
  assert.match(page, /identity\.status === "recovery"/);
  assert.match(route, /identity\.status !== "recovery"/);
  assert.match(form, /autoComplete="new-password"/);
  assert.equal((form.match(/autoComplete="new-password"/g) ?? []).length, 2);
});

test("reset-password accepts only safe semantic statuses and keeps retryable forms visible", async () => {
  const [route, page, form] = await Promise.all([
    source("app", "reset-password", "complete", "route.ts"),
    source("app", "reset-password", "page.tsx"),
    source("components", "auth", "reset-password-form.tsx"),
  ]);

  assert.match(page, /"same-password"/);
  assert.match(page, /"weak-password"/);
  assert.match(route, /"same-password": "same-password"/);
  assert.match(route, /"weak-password": "weak-password"/);
  assert.match(form, /status === "same-password"[\s\S]*RECOVERY_SAME_PASSWORD_MESSAGE/);
  assert.match(form, /status === "weak-password"[\s\S]*RECOVERY_WEAK_PASSWORD_MESSAGE/);
  assert.match(form, /Mínimo 8 caracteres/);
  assert.match(form, /Los caracteres especiales son opcionales/);
  assert.match(form, /name="password"/);
  assert.doesNotMatch(form, /passwordReset=success|searchParams|query/i);
  assert.equal(
    RECOVERY_SAME_PASSWORD_MESSAGE,
    "La nueva contraseña debe ser distinta de la contraseña actual.",
  );
  assert.equal(
    RECOVERY_WEAK_PASSWORD_MESSAGE,
    "La contraseña no cumple los requisitos de seguridad. Revisa los requisitos e inténtalo con otra.",
  );
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
    /createSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY|auth\.admin|auth\.users|profiles|rpc\(|updateUserById|localStorage|sessionStorage/,
  );
  assert.doesNotMatch(implementation, /console\.(?:log|error|warn)/);
});
