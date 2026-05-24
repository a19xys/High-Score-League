const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  timeZone: "UTC",
});

const weekdayDateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const weekdayDateFormatter = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
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

export function formatWeekRange(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const startMonth = start.getUTCMonth();
  const endMonth = end.getUTCMonth();
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const sameMonth = startMonth === endMonth;
  const sameYear = startYear === endYear;

  if (sameMonth && sameYear) {
    return `${startDay}–${endDay} de ${monthFormatter.format(end)} de ${endYear}`;
  }

  if (sameYear) {
    return `${startDay} de ${monthFormatter.format(start)} – ${endDay} de ${monthFormatter.format(end)} de ${endYear}`;
  }

  return `${formatDate(start.toISOString())} – ${formatDate(end.toISOString())}`;
}

export function formatScore(value: number) {
  return new Intl.NumberFormat("es-ES").format(value);
}

export function formatRelativeTime(value: string, now = new Date()) {
  const target = new Date(value);
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - target.getTime()) / 1000));

  if (diffSeconds < 60) {
    return `hace ${diffSeconds || 1} ${diffSeconds === 1 ? "segundo" : "segundos"}`;
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

export function formatGap(value: number) {
  if (value === 0) {
    return "";
  }

  return `-${formatScore(value)}`;
}
