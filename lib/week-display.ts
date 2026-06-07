import type { Week } from "@/types";
import {
  formatDateTime,
  formatLongDateWithoutYear,
} from "@/lib/format";

export type WeekDisplayTone = "inactive" | "active" | "frozen" | "closed";

export type WeekStatusDisplay = {
  label: string;
  secondary: string;
  tone: WeekDisplayTone;
  countdownPrefix?: string;
  countdownTarget?: string;
  countdownExpiredText?: string;
  noticeTitle: string;
  noticeBody?: string;
  noticeTitleAttribute?: string;
  noticeBodyTitleAttribute?: string;
};

function parseTime(value?: string | null) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function formatWeekCountdown(
  prefix: string,
  target?: string | null,
  now = new Date(),
) {
  const targetTime = parseTime(target);

  if (targetTime === null) {
    return null;
  }

  const diff = targetTime - now.getTime();

  if (diff <= 0) {
    return null;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;

  if (diff >= dayMs) {
    const days = Math.floor(diff / dayMs);
    const hours = Math.floor((diff % dayMs) / hourMs);
    return `${prefix} ${days}d ${hours}h`;
  }

  const totalMinutes = Math.max(1, Math.ceil(diff / minuteMs));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${prefix} ${hours}h ${minutes}m`;
}

function formatShortDate(value?: string | null) {
  if (!value || parseTime(value) === null) {
    return null;
  }

  return formatLongDateWithoutYear(value);
}

function exactDate(value?: string | null) {
  if (!value || parseTime(value) === null) {
    return undefined;
  }

  return formatDateTime(value);
}

export function getWeekStatusDisplay(
  week: Pick<
    Week,
    "status" | "startsAt" | "endsAt" | "publicFreezeAt"
  >,
  now = new Date(),
): WeekStatusDisplay {
  if (week.status === "published") {
    return {
      label: "CERRADA",
      secondary: "Se ha acabado el plazo.",
      tone: "closed",
      noticeTitle: "Resultados oficiales publicados.",
      noticeBody: "Esta semana ya cuenta para la clasificación de temporada.",
    };
  }

  if (week.status === "closed") {
    return {
      label: "CERRADA",
      secondary: "Se ha acabado el plazo.",
      tone: "closed",
      noticeTitle: "El plazo ha terminado y las puntuaciones ya están reveladas.",
      noticeBody: "Resultados oficiales pendientes de publicación.",
    };
  }

  if (week.status === "frozen") {
    const closeDate = formatShortDate(week.endsAt);

    return {
      label: "TRAMO FINAL",
      secondary:
        formatWeekCountdown("Termina en", week.endsAt, now) ??
        "Se ha acabado el plazo.",
      tone: "frozen",
      countdownPrefix: "Termina en",
      countdownTarget: week.endsAt,
      countdownExpiredText: "Se ha acabado el plazo.",
      noticeTitle: "Las nuevas puntuaciones permanecerán ocultas hasta el cierre.",
      noticeBody: closeDate ? `Se revelarán el ${closeDate}.` : undefined,
      noticeBodyTitleAttribute: exactDate(week.endsAt),
    };
  }

  if (week.status === "active") {
    const finalStretchTime = parseTime(week.publicFreezeAt);
    const finalStretchIsFuture =
      finalStretchTime !== null && finalStretchTime > now.getTime();
    const finalStretchDate = finalStretchIsFuture
      ? formatShortDate(week.publicFreezeAt)
      : null;

    return {
      label: "ACTIVA",
      secondary:
        formatWeekCountdown("Termina en", week.endsAt, now) ??
        "Se ha acabado el plazo.",
      tone: "active",
      countdownPrefix: "Termina en",
      countdownTarget: week.endsAt,
      countdownExpiredText: "Se ha acabado el plazo.",
      noticeTitle: finalStretchIsFuture
        ? "Las puntuaciones serán visibles hasta el tramo final."
        : "Las puntuaciones serán visibles hasta el cierre de la semana.",
      noticeBody: finalStretchDate
        ? `El tramo final comienza el ${finalStretchDate}.`
        : undefined,
      noticeBodyTitleAttribute: finalStretchIsFuture
        ? exactDate(week.publicFreezeAt)
        : undefined,
    };
  }

  const startDate = formatShortDate(week.startsAt);

  return {
    label: "INACTIVA",
    secondary:
      formatWeekCountdown("Comienza en", week.startsAt, now) ??
      "Actualiza para ver el estado.",
    tone: "inactive",
    countdownPrefix: "Comienza en",
    countdownTarget: week.startsAt,
    countdownExpiredText: "Actualiza para ver el estado.",
    noticeTitle: "La competición todavía no ha empezado.",
    noticeBody: startDate
      ? `Podrás enviar puntuaciones a partir del ${startDate}.`
      : undefined,
    noticeBodyTitleAttribute: exactDate(week.startsAt),
  };
}
