export type PlayerPlayTimeDto =
  | { visibility: "visible"; totalSeconds: number }
  | { visibility: "private" };

export type PlayerPlayTime =
  | PlayerPlayTimeDto
  | { visibility: "unavailable" };

export function formatPlayTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (seconds === 0) return "No jugado";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 7200) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min`;
  }
  return `${(seconds / 3600).toLocaleString("es-ES", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    useGrouping: false,
  })} h`;
}
