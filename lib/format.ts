const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const monthYearFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
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
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();

  if (sameMonth && sameYear) {
    return `${start.getDate()}–${end.getDate()} ${monthYearFormatter.format(end)}`;
  }

  if (sameYear) {
    const startMonth = new Intl.DateTimeFormat("es-ES", {
      month: "long",
    }).format(start);
    return `${start.getDate()} ${startMonth} – ${end.getDate()} ${monthYearFormatter.format(end)}`;
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

export function formatPodiumGap(rank: 1 | 2 | 3, gap: number) {
  return `${rank}.º: -${formatScore(gap)}`;
}
