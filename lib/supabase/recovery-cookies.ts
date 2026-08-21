import type { CookieOptions } from "@supabase/ssr";
import {
  getRecoveryCookieOptions,
  RECOVERY_AUTHORIZED_COOKIE,
  RECOVERY_LOGOUT_PENDING_COOKIE,
  RECOVERY_MAX_AGE_SECONDS,
  RECOVERY_STAGING_COOKIE,
} from "../auth/password-recovery.ts";

export const RECOVERY_AUTH_STORAGE_KEY = "hsl-recovery-auth";
export const RECOVERY_AUTH_COOKIE_PATH = "/reset-password";

type CookieRecord = { name: string; value: string };
type CookieWrite = {
  name: string;
  value: string;
  options: CookieOptions;
};
type MutableCookieStore = {
  getAll(): CookieRecord[];
  set(name: string, value: string, options: CookieOptions): void;
};
type RecoveryResponse = {
  cookies: {
    set(name: string, value: string, options: CookieOptions): unknown;
  };
  headers: { set(name: string, value: string): unknown };
};

function isCookieDeletion(cookie: CookieWrite) {
  const expires = cookie.options.expires;
  return (
    cookie.options.maxAge === 0 ||
    (expires instanceof Date && expires.getTime() <= 0)
  );
}

export function getRecoveryAuthCookieOptions(
  cookie: CookieWrite,
  isProduction = process.env.NODE_ENV === "production",
): CookieOptions {
  const deletion = isCookieDeletion(cookie);

  return {
    ...cookie.options,
    httpOnly: true,
    maxAge: deletion ? 0 : RECOVERY_MAX_AGE_SECONDS,
    path: RECOVERY_AUTH_COOKIE_PATH,
    sameSite: "lax",
    secure: isProduction,
  };
}

export function createRecoveryCookieAdapter(
  cookieStore: MutableCookieStore,
  responseHeaders: Headers,
  isProduction = process.env.NODE_ENV === "production",
) {
  return {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet: CookieWrite[], headers: Record<string, string>) {
      for (const cookie of cookiesToSet) {
        cookieStore.set(
          cookie.name,
          cookie.value,
          getRecoveryAuthCookieOptions(cookie, isProduction),
        );
      }

      for (const [name, value] of Object.entries(headers)) {
        responseHeaders.set(name, value);
      }
    },
  };
}

export function applyRecoveryAuthHeaders(
  response: RecoveryResponse,
  headers: Headers,
) {
  headers.forEach((value, name) => response.headers.set(name, value));
}

export function isRecoveryAuthCookieName(name: string) {
  return (
    name === RECOVERY_AUTH_STORAGE_KEY ||
    name.startsWith(`${RECOVERY_AUTH_STORAGE_KEY}.`)
  );
}

export function getRecoveryAuthCookieNames(cookiesToInspect: CookieRecord[]) {
  return Array.from(
    new Set([
      RECOVERY_AUTH_STORAGE_KEY,
      ...cookiesToInspect
        .map((cookie) => cookie.name)
        .filter(isRecoveryAuthCookieName),
    ]),
  );
}

export function clearRecoveryState(
  response: RecoveryResponse,
  cookiesToInspect: CookieRecord[],
  scope: {
    auth?: boolean;
    markers?: boolean;
    staging?: boolean;
  },
) {
  const expire = (name: string, path: string) => {
    response.cookies.set(name, "", {
      ...getRecoveryCookieOptions(path),
      expires: new Date(0),
      maxAge: 0,
    });
  };

  if (scope.staging) {
    expire(RECOVERY_STAGING_COOKIE, "/auth/recovery");
  }

  if (scope.markers) {
    expire(RECOVERY_AUTHORIZED_COOKIE, RECOVERY_AUTH_COOKIE_PATH);
    expire(RECOVERY_LOGOUT_PENDING_COOKIE, RECOVERY_AUTH_COOKIE_PATH);
  }

  if (scope.auth) {
    for (const name of getRecoveryAuthCookieNames(cookiesToInspect)) {
      expire(name, RECOVERY_AUTH_COOKIE_PATH);
    }
  }
}
