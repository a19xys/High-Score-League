const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoWithTimeZonePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type PlayTimeEvent = {
  schemaVersion: 1;
  eventId: string;
  weekId: string;
  gameKey: string;
  rom: string | null;
  mode: "practice" | "competition";
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  clientVersion: string | null;
};

export type PlayTimeValidation =
  | { ok: true; value: PlayTimeEvent }
  | { ok: false; error: string };

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return { ok: true as const, value: null };
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    return { ok: false as const, error: `${field} no es válido.` };
  }
  return { ok: true as const, value: value.trim() };
}

export function validatePlayTimePayload(payload: unknown): PlayTimeValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "El payload debe ser un objeto JSON." };
  }
  const input = payload as Record<string, unknown>;
  if ("playerId" in input || "player_id" in input) {
    return { ok: false, error: "playerId no se acepta desde cliente." };
  }
  if (input.schemaVersion !== 1) return { ok: false, error: "schemaVersion no soportada." };
  if (typeof input.eventId !== "string" || !uuidPattern.test(input.eventId)) {
    return { ok: false, error: "eventId debe ser un UUID válido." };
  }
  if (typeof input.weekId !== "string" || !uuidPattern.test(input.weekId)) {
    return { ok: false, error: "weekId debe ser un UUID válido." };
  }
  if (typeof input.gameKey !== "string" || !input.gameKey.trim() || input.gameKey.trim().length > 128) {
    return { ok: false, error: "gameKey no es válido." };
  }
  if (input.mode !== "practice" && input.mode !== "competition") {
    return { ok: false, error: "mode debe ser practice o competition." };
  }
  if (!Number.isInteger(input.durationSeconds) || Number(input.durationSeconds) < 1 || Number(input.durationSeconds) > 604800) {
    return { ok: false, error: "durationSeconds no es válido." };
  }
  for (const field of ["startedAt", "endedAt"] as const) {
    const value = input[field];
    if (typeof value !== "string" || !isoWithTimeZonePattern.test(value) || !Number.isFinite(Date.parse(value))) {
      return { ok: false, error: `${field} debe ser una fecha ISO válida con zona horaria.` };
    }
  }
  if (Date.parse(input.endedAt as string) < Date.parse(input.startedAt as string)) {
    return { ok: false, error: "endedAt no puede ser anterior a startedAt." };
  }
  const rom = optionalText(input.rom, "rom", 128);
  if (!rom.ok) return rom;
  const clientVersion = optionalText(input.clientVersion, "clientVersion", 64);
  if (!clientVersion.ok) return clientVersion;
  return {
    ok: true,
    value: {
      clientVersion: clientVersion.value,
      durationSeconds: Number(input.durationSeconds),
      endedAt: input.endedAt as string,
      eventId: input.eventId,
      gameKey: input.gameKey.trim(),
      mode: input.mode,
      rom: rom.value,
      schemaVersion: 1,
      startedAt: input.startedAt as string,
      weekId: input.weekId,
    },
  };
}
