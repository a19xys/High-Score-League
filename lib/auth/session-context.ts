type ClaimsResult = {
  data: { claims: unknown } | null;
  error: unknown | null;
};

type UserResult = {
  data: {
    user: {
      id: string;
      email?: string | null;
      user_metadata?: Record<string, unknown>;
    } | null;
  };
  error: unknown | null;
};

export type VerifiableAuthClient = {
  getClaims(accessToken?: string): PromiseLike<ClaimsResult>;
  getUser(accessToken?: string): PromiseLike<UserResult>;
};

export type VerifiedSessionContext =
  | { status: "signed-out"; userId: null }
  | { status: "product"; userId: string }
  | { status: "recovery"; userId: string }
  | { status: "invalid"; userId: null }
  | { status: "unavailable"; userId: null };

export type VerifiedSessionIdentity =
  | {
      status: "product";
      userId: string;
      user: NonNullable<UserResult["data"]["user"]>;
    }
  | {
      status: "recovery";
      userId: string;
      user: NonNullable<UserResult["data"]["user"]>;
    }
  | Exclude<
      VerifiedSessionContext,
      { status: "product" | "recovery" }
    >;

export type VerifiedProductIdentity =
  | Extract<VerifiedSessionIdentity, { status: "product" }>
  | Exclude<VerifiedSessionContext, { status: "product" }>;

function authenticationMethods(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.every((entry) => typeof entry === "string")) {
    const methods = value as string[];
    return methods.every(
      (method) => method.length > 0 && method === method.trim(),
    )
      ? methods
      : null;
  }

  if (
    value.every(
      (entry) =>
        Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as Record<string, unknown>).method === "string" &&
        ((entry as Record<string, unknown>).method as string).length > 0 &&
        (entry as Record<string, unknown>).method ===
          ((entry as Record<string, unknown>).method as string).trim() &&
        typeof (entry as Record<string, unknown>).timestamp === "number" &&
        Number.isFinite((entry as Record<string, unknown>).timestamp),
    )
  ) {
    return (value as Array<{ method: string }>).map((entry) => entry.method);
  }

  return null;
}

export function classifyVerifiedSessionClaims(
  claims: unknown,
): VerifiedSessionContext {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return { status: "invalid", userId: null };
  }

  const record = claims as Record<string, unknown>;

  if (
    record.role !== "authenticated" ||
    typeof record.sub !== "string" ||
    record.sub.length === 0
  ) {
    return { status: "invalid", userId: null };
  }

  if (!("amr" in record)) {
    return { status: "product", userId: record.sub };
  }

  const methods = authenticationMethods(record.amr);

  if (!methods) {
    return { status: "invalid", userId: null };
  }

  return methods.includes("recovery")
    ? { status: "recovery", userId: record.sub }
    : { status: "product", userId: record.sub };
}

async function readClaims(
  auth: VerifiableAuthClient,
  accessToken?: string,
) {
  return accessToken === undefined
    ? auth.getClaims()
    : auth.getClaims(accessToken);
}

async function readUser(
  auth: VerifiableAuthClient,
  accessToken?: string,
) {
  return accessToken === undefined
    ? auth.getUser()
    : auth.getUser(accessToken);
}

export async function getVerifiedSessionContext(
  auth: VerifiableAuthClient,
  accessToken?: string,
): Promise<VerifiedSessionContext> {
  let result: ClaimsResult;

  try {
    result = await readClaims(auth, accessToken);
  } catch {
    return { status: "unavailable", userId: null };
  }

  if (result.error) {
    return { status: "invalid", userId: null };
  }

  if (!result.data?.claims) {
    return accessToken === undefined
      ? { status: "signed-out", userId: null }
      : { status: "invalid", userId: null };
  }

  return classifyVerifiedSessionClaims(result.data.claims);
}

export async function getVerifiedIdentityForContext(
  auth: VerifiableAuthClient,
  context: VerifiedSessionContext,
  accessToken?: string,
): Promise<VerifiedSessionIdentity> {
  if (context.status !== "product" && context.status !== "recovery") {
    return context;
  }

  let result: UserResult;

  try {
    result = await readUser(auth, accessToken);
  } catch {
    return { status: "unavailable", userId: null };
  }

  if (
    result.error ||
    !result.data.user ||
    result.data.user.id !== context.userId
  ) {
    return { status: "invalid", userId: null };
  }

  return {
    status: context.status,
    userId: context.userId,
    user: result.data.user,
  };
}

export async function getVerifiedSessionIdentity(
  auth: VerifiableAuthClient,
  accessToken?: string,
) {
  const context = await getVerifiedSessionContext(auth, accessToken);
  return getVerifiedIdentityForContext(auth, context, accessToken);
}

export async function getVerifiedProductIdentity(
  auth: VerifiableAuthClient,
  accessToken?: string,
): Promise<VerifiedProductIdentity> {
  const context = await getVerifiedSessionContext(auth, accessToken);

  if (context.status !== "product") {
    return context;
  }

  return getVerifiedIdentityForContext(auth, context, accessToken);
}

export function extractBearerAccessToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer ([^\s,]+)$/i);
  return match?.[1] ?? null;
}
