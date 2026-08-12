const STATUS_PRESENTATIONS = Object.freeze({
  active: Object.freeze({
    className: "week-status--ready",
    signalTone: "success",
    label: "ACTIVA",
    title: "La semana competitiva esta activa.",
  }),
  closed: Object.freeze({
    className: "week-status--closed",
    signalTone: "warning",
    label: "CERRADA",
    title: "La semana competitiva esta cerrada.",
  }),
  error: Object.freeze({
    className: "week-status--error",
    signalTone: "error",
    label: "REQUIERE ATENCION",
    title: "Este pack esta incompleto o no es valido.",
  }),
  inactive: Object.freeze({
    className: "week-status--warning",
    signalTone: "warning",
    label: "INACTIVA",
    title: "La semana competitiva todavia no esta activa.",
  }),
  unlinked: Object.freeze({
    className: "week-status--warning",
    signalTone: "warning",
    label: "SIN VINCULAR",
    title: "El pack no esta vinculado a una semana publica.",
  }),
  unknown: Object.freeze({
    className: "week-status--unknown",
    signalTone: "neutral",
    label: "SIN DATOS",
    title: "Todavia no se ha confirmado el estado de la semana.",
  }),
});

export const LIBRARY_PACK_STATUS_CLASSES = Object.freeze(
  [...new Set(Object.values(STATUS_PRESENTATIONS).map((presentation) => presentation.className))],
);

export const LIBRARY_PACK_STATUS_TONES = Object.freeze(
  [...new Set(Object.values(STATUS_PRESENTATIONS).map((presentation) => presentation.signalTone))],
);

export function deriveLibraryPackStatus(pack = {}) {
  if (pack.status === "error") return STATUS_PRESENTATIONS.error;
  const state = pack.weekCapability?.publicState || (pack.weekId ? "unknown" : "unlinked");
  return STATUS_PRESENTATIONS[state] || STATUS_PRESENTATIONS.unknown;
}
