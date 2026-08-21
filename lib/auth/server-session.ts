type ServerAuthClient = {
  getUser(): PromiseLike<{
    data: {
      user: { id: string; email?: string | null } | null;
    };
    error: unknown;
  }>;
};

export type ServerSession =
  | { status: "not-configured"; userId: null; email: null }
  | { status: "signed-out"; userId: null; email: null }
  | { status: "signed-in"; userId: string; email: string | null };

export async function resolveServerSession(
  auth: ServerAuthClient | null,
): Promise<ServerSession> {
  if (!auth) {
    return { status: "not-configured", userId: null, email: null };
  }

  try {
    const { data, error } = await auth.getUser();

    if (error || !data.user) {
      return { status: "signed-out", userId: null, email: null };
    }

    return {
      status: "signed-in",
      userId: data.user.id,
      email: data.user.email ?? null,
    };
  } catch {
    return { status: "signed-out", userId: null, email: null };
  }
}
