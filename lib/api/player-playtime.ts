import type { PlayerPlayTimeSnapshotReadResult } from "@/lib/data/player-playtime";

type ViewerResult =
  | { status: "signed-in"; userId: string }
  | { status: "signed-out" }
  | { status: "error" };

export type PlayerPlayTimeApiDependencies<Client> = {
  createClient: () => Promise<Client | null>;
  getViewer: (client: Client) => Promise<ViewerResult>;
  hasActiveProfile: (
    client: Client,
    userId: string,
  ) => Promise<{ active: boolean; error: string | null }>;
  isValidUsername: (username: string) => boolean;
  readSnapshot: (
    client: Client,
    username: string,
    viewerUserId: string,
  ) => Promise<PlayerPlayTimeSnapshotReadResult>;
};

export type PlayerPlayTimeApiResult = {
  status: number;
  body: Record<string, unknown>;
};

const failure = (status: number, error: string): PlayerPlayTimeApiResult => ({
  status,
  body: { ok: false, error },
});

export async function resolvePlayerPlayTimeApi<Client>(
  username: string,
  dependencies: PlayerPlayTimeApiDependencies<Client>,
): Promise<PlayerPlayTimeApiResult> {
  try {
    const client = await dependencies.createClient();
    if (!client) return failure(503, "Playtime no está configurado.");

    const viewer = await dependencies.getViewer(client);
    if (viewer.status === "signed-out") {
      return failure(401, "Necesitas una sesión válida.");
    }
    if (viewer.status === "error") {
      return failure(503, "Playtime no está disponible.");
    }
    if (!dependencies.isValidUsername(username)) {
      return failure(400, "Jugador no válido.");
    }

    const viewerProfile = await dependencies.hasActiveProfile(
      client,
      viewer.userId,
    );
    if (viewerProfile.error) {
      return failure(503, "Playtime no está disponible.");
    }
    if (!viewerProfile.active) {
      return failure(403, "Necesitas un perfil activo.");
    }

    const result = await dependencies.readSnapshot(
      client,
      username,
      viewer.userId,
    );
    if (!result.ok) {
      if (result.error === "not-found") {
        return failure(404, "Jugador no encontrado.");
      }
      return failure(503, "Playtime no está disponible.");
    }

    return { status: 200, body: { ok: true, playTime: result.playTime } };
  } catch {
    return failure(503, "Playtime no está disponible.");
  }
}
