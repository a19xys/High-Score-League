export type PlayerPlayTime =
  | { visibility: "visible"; totalSeconds: number }
  | { visibility: "private" };

export function formatPlayTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds === 0) return "0 minutos";
  if (seconds < 60) return "Menos de 1 minuto";
  if (seconds < 7200) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }
  return `${(seconds / 3600).toLocaleString("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    useGrouping: false,
  })} horas`;
}
