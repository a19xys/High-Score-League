import type { PresenceMode } from "@/lib/player-presence";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validClientId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 36 && uuidPattern.test(value);
}

export type WebPresencePayload = { version: 1; clientId: string };

export function validateWebPresencePayload(value: unknown): Validation<WebPresencePayload> {
  if (!exactObject(value, ["clientId", "version"])) {
    return { ok: false, error: "El payload de Presence contiene campos no permitidos." };
  }
  if (value.version !== 1 || !validClientId(value.clientId)) {
    return { ok: false, error: "El payload de Presence no es válido." };
  }
  return { ok: true, value: { version: 1, clientId: value.clientId } };
}

export type LauncherPresencePayload = {
  version: 1;
  clientId: string;
  activity: "connected" | "playing";
  weekId: string | null;
  mode: PresenceMode | null;
};

export function validateLauncherPresencePayload(value: unknown): Validation<LauncherPresencePayload> {
  if (!exactObject(value, ["activity", "clientId", "mode", "version", "weekId"])) {
    return { ok: false, error: "El payload de Presence contiene campos no permitidos." };
  }
  if (value.version !== 1 || !validClientId(value.clientId)) {
    return { ok: false, error: "El payload de Presence no es válido." };
  }
  if (value.activity !== "connected" && value.activity !== "playing") {
    return { ok: false, error: "La actividad de Presence no es válida." };
  }
  if (value.weekId !== null && (typeof value.weekId !== "string" || !uuidPattern.test(value.weekId))) {
    return { ok: false, error: "La semana de Presence no es válida." };
  }
  if (value.activity === "connected" && (value.weekId !== null || value.mode !== null)) {
    return { ok: false, error: "La presencia conectada no acepta contexto de juego." };
  }
  if (value.activity === "playing" && value.mode !== "practice" && value.mode !== "competition") {
    return { ok: false, error: "El modo de Presence no es válido." };
  }
  return {
    ok: true,
    value: {
      version: 1,
      clientId: value.clientId,
      activity: value.activity,
      weekId: value.weekId as string | null,
      mode: value.mode as PresenceMode | null,
    },
  };
}

export function validatePresenceDeletePayload(value: unknown): Validation<WebPresencePayload> {
  return validateWebPresencePayload(value);
}

