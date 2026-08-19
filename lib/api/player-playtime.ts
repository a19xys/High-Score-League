import type { PlayerPlayTimeReadResult } from "@/lib/data/player-playtime";

type ViewerResult =
  | { status: "signed-in"; userId: string }
  | { status: "signed-out" }
  | { status: "error" };

type TargetResult =
  | { status: "ok"; id: string; playTimePublic: boolean }
  | { status: "not-found" }
  | { status: "error" };

export type PlayerPlayTimeApiDependencies<Client> = {
  createClient: () => Promise<Client | null>;
  getViewer: (client: Client) => Promise<ViewerResult>;
  hasActiveProfile: (
    client: Client,
    userId: string,
  ) => Promise<{ active: boolean; error: string | null }>;
  isValidUsername: (username: string) => boolean;
  findTarget: (client: Client, username: string) => Promise<TargetResult>;
  readPlayTime: (
    client: Client,
    playerId: string,
    access: { isOwner: boolean; playTimePublic: boolean },
  ) => Promise<PlayerPlayTimeReadResult>;
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

    const target = await dependencies.findTarget(client, username);
    if (target.status === "error") {
      return failure(503, "Playtime no está disponible.");
    }
    if (target.status === "not-found") {
      return failure(404, "Jugador no encontrado.");
    }

    const result = await dependencies.readPlayTime(client, target.id, {
      isOwner: viewer.userId === target.id,
      playTimePublic: target.playTimePublic,
    });
    if (!result.ok) {
      return failure(503, "Playtime no está disponible.");
    }

    return { status: 200, body: { ok: true, playTime: result.playTime } };
  } catch {
    return failure(503, "Playtime no está disponible.");
  }
}
