import {
  getVerifiedIdentityForContext,
  getVerifiedSessionContext,
  type VerifiableAuthClient,
} from "./session-context.ts";

export type ServerSession =
  | { status: "not-configured"; userId: null; email: null }
  | { status: "signed-out"; userId: null; email: null }
  | { status: "recovery"; userId: null; email: null }
  | { status: "invalid"; userId: null; email: null }
  | { status: "signed-in"; userId: string; email: string | null };

export async function resolveServerSession(
  auth: VerifiableAuthClient | null,
): Promise<ServerSession> {
  if (!auth) {
    return { status: "not-configured", userId: null, email: null };
  }

  const context = await getVerifiedSessionContext(auth);

  if (context.status === "recovery") {
    return { status: "recovery", userId: null, email: null };
  }

  if (context.status === "signed-out") {
    return { status: "signed-out", userId: null, email: null };
  }

  if (context.status !== "product") {
    return { status: "invalid", userId: null, email: null };
  }

  const identity = await getVerifiedIdentityForContext(auth, context);

  if (identity.status !== "product") {
    return { status: "invalid", userId: null, email: null };
  }

  return {
    status: "signed-in",
    userId: identity.userId,
    email: identity.user.email ?? null,
  };
}
