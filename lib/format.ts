export const competitionTimeZone = "Europe/Madrid";

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: competitionTimeZone,
});

const monthFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  timeZone: competitionTimeZone,
});

const weekdayDateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: competitionTimeZone,
});

const weekdayDateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: competitionTimeZone,
});

const exactDateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: competitionTimeZone,
});

const compactDateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: competitionTimeZone,
});

export function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string) {
  return weekdayDateTimeFormatter.format(new Date(value));
}

export function formatLongDate(value: string) {
  return weekdayDateFormatter.format(new Date(value));
}

function getMadridDateParts(value: string) {
  const parts = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: competitionTimeZone,
  }).formatToParts(new Date(value));

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    day: getPart("day"),
    month: getPart("month"),
    year: getPart("year"),
  };
}

export function formatWeekRange(startsAt: string, endsAt: string) {
  const start = getMadridDateParts(startsAt);
  const end = getMadridDateParts(endsAt);
  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);
  const sameMonth = start.month === end.month;
  const sameYear = start.year === end.year;

  if (sameMonth && sameYear) {
    return `${start.day}–${end.day} de ${monthFormatter.format(endDate)} de ${end.year}`;
  }

  if (sameYear) {
    return `${start.day} de ${monthFormatter.format(startDate)} – ${end.day} de ${monthFormatter.format(endDate)} de ${end.year}`;
  }

  return `${start.day} de ${monthFormatter.format(startDate)} de ${start.year} – ${end.day} de ${monthFormatter.format(endDate)} de ${end.year}`;
}

export function formatCompactDateRange(startsAt: string, endsAt: string) {
  return `${compactDateFormatter.format(new Date(startsAt))} – ${compactDateFormatter.format(new Date(endsAt))}`;
}

export function formatScore(value: number) {
  return new Intl.NumberFormat("es-ES").format(value);
}

export function formatRelativeTime(value: string, now = new Date()) {
  const target = new Date(value);
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - target.getTime()) / 1000));

  if (diffSeconds < 60) {
    return "ahora mismo";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `hace ${diffMinutes} ${diffMinutes === 1 ? "minuto" : "minutos"}`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
}

export function formatExactDateTime(value: string) {
  return exactDateTimeFormatter.format(new Date(value));
}

export function formatGap(value: number) {
  if (value === 0) {
    return "";
  }

  return `-${formatScore(value)}`;
}
