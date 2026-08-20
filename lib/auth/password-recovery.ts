import { validateNewPassword } from "./validation.ts";

export const RECOVERY_STAGING_COOKIE = "hsl_password_recovery_staged";
export const RECOVERY_AUTHORIZED_COOKIE = "hsl_password_recovery_authorized";
export const RECOVERY_LOGOUT_PENDING_COOKIE =
  "hsl_password_recovery_logout_pending";
export const RECOVERY_COOKIE_VALUE = "1";
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;
export const RECOVERY_TOKEN_MAX_LENGTH = 2048;

export const RECOVERY_GENERIC_SUCCESS =
  "Si existe una cuenta asociada a ese email, recibirás un enlace para cambiar la contraseña.";
export const RECOVERY_RATE_LIMIT_MESSAGE =
  "Has solicitado un enlace recientemente. Espera un poco antes de intentarlo de nuevo.";
export const RECOVERY_UNAVAILABLE_MESSAGE =
  "La recuperación de contraseña no está disponible ahora mismo. Inténtalo de nuevo más tarde.";
export const RECOVERY_INVALID_MESSAGE =
  "Este enlace de recuperación ya no es válido. Solicita uno nuevo.";
export const RECOVERY_UPDATE_ERROR_MESSAGE =
  "No hemos podido actualizar la contraseña. Inténtalo de nuevo.";
export const RECOVERY_LOGOUT_ERROR_MESSAGE =
  "La contraseña se ha actualizado, pero no hemos podido cerrar todas las sesiones. Inténtalo de nuevo para completar el proceso.";

type RecoveryErrorShape = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

type PasswordRecoveryRequestAuth = {
  resetPasswordForEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<{ error: unknown | null }>;
};

type RecoveryVerifyAuth = {
  verifyOtp(input: {
    token_hash: string;
    type: "recovery";
  }): Promise<{ error: unknown | null }>;
};

type RecoveryCompletionAuth = {
  signOut(options: { scope: "global" }): Promise<{ error: unknown | null }>;
  updateUser(input: { password: string }): Promise<{ error: unknown | null }>;
};

export type PasswordRecoveryRequestResult =
  | { kind: "accepted"; message: string }
  | { kind: "invalid-email"; message: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "unavailable"; message: string };

export type PasswordRecoveryCompletionResult =
  | { kind: "logout-error" }
  | { kind: "mismatch" }
  | { kind: "policy-error" }
  | { kind: "success" }
  | { kind: "update-error" };

export function getRecoveryCookieOptions(path: string) {
  return {
    httpOnly: true,
    maxAge: RECOVERY_MAX_AGE_SECONDS,
    path,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function isValidRecoveryEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isStructurallyValidRecoveryToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= RECOVERY_TOKEN_MAX_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function selectRecoveryToken(values: string[]) {
  if (values.length !== 1 || !isStructurallyValidRecoveryToken(values[0])) {
    return null;
  }

  return values[0];
}

export function hasRecoveryMarker(value: string | undefined) {
  return value === RECOVERY_COOKIE_VALUE;
}

export function isAuthorizedRecoverySession(
  markerValue: string | undefined,
  hasAuthenticatedUser: boolean,
) {
  return hasRecoveryMarker(markerValue) && hasAuthenticatedUser;
}

function recoveryErrorShape(error: unknown): RecoveryErrorShape {
  if (!error || typeof error !== "object") {
    return {};
  }

  return error as RecoveryErrorShape;
}

function isRateLimitError(error: unknown) {
  const shape = recoveryErrorShape(error);
  const status = typeof shape.status === "number" ? shape.status : null;
  const code = typeof shape.code === "string" ? shape.code.toLowerCase() : "";
  const message =
    typeof shape.message === "string" ? shape.message.toLowerCase() : "";

  return (
    status === 429 ||
    code.includes("rate_limit") ||
    message.includes("rate limit") ||
    message.includes("too many requests")
  );
}

function isOperationalRecoveryError(error: unknown) {
  const shape = recoveryErrorShape(error);
  const status = typeof shape.status === "number" ? shape.status : null;
  const message =
    typeof shape.message === "string" ? shape.message.toLowerCase() : "";

  return (
    (status !== null && status >= 500) ||
    message.includes("failed to fetch") ||
    message.includes("network")
  );
}

export async function requestPasswordRecovery(input: {
  auth: PasswordRecoveryRequestAuth | null;
  email: string;
  origin: string;
}): Promise<PasswordRecoveryRequestResult> {
  const email = input.email.trim();

  if (!isValidRecoveryEmail(email)) {
    return { kind: "invalid-email", message: "Introduce un email válido." };
  }

  if (!input.auth) {
    return { kind: "unavailable", message: RECOVERY_UNAVAILABLE_MESSAGE };
  }

  let error: unknown | null;

  try {
    const result = await input.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/auth/recovery/start", input.origin).toString(),
    });
    error = result.error;
  } catch {
    return { kind: "unavailable", message: RECOVERY_UNAVAILABLE_MESSAGE };
  }

  if (isRateLimitError(error)) {
    return { kind: "rate-limited", message: RECOVERY_RATE_LIMIT_MESSAGE };
  }

  if (isOperationalRecoveryError(error)) {
    return { kind: "unavailable", message: RECOVERY_UNAVAILABLE_MESSAGE };
  }

  // Auth-level responses remain intentionally indistinguishable so the UI
  // cannot reveal whether an address is registered.
  return { kind: "accepted", message: RECOVERY_GENERIC_SUCCESS };
}

export async function verifyRecoveryOtp(
  auth: RecoveryVerifyAuth,
  tokenHash: string,
) {
  if (!isStructurallyValidRecoveryToken(tokenHash)) {
    return false;
  }

  try {
    const { error } = await auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    return !error;
  } catch {
    return false;
  }
}

export async function completePasswordRecovery(input: {
  auth: RecoveryCompletionAuth;
  confirmation: string;
  password: string;
}): Promise<PasswordRecoveryCompletionResult> {
  if (input.password !== input.confirmation) {
    return { kind: "mismatch" };
  }

  if (validateNewPassword(input.password)) {
    return { kind: "policy-error" };
  }

  try {
    const { error } = await input.auth.updateUser({ password: input.password });

    if (error) {
      return { kind: "update-error" };
    }
  } catch {
    return { kind: "update-error" };
  }

  try {
    const { error } = await input.auth.signOut({ scope: "global" });

    if (error) {
      return { kind: "logout-error" };
    }
  } catch {
    return { kind: "logout-error" };
  }

  return { kind: "success" };
}

export async function retryGlobalRecoverySignOut(auth: {
  signOut(options: { scope: "global" }): Promise<{ error: unknown | null }>;
}) {
  try {
    const { error } = await auth.signOut({ scope: "global" });
    return !error;
  } catch {
    return false;
  }
}
