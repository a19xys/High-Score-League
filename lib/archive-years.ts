export const ARCHIVE_TIME_ZONE = "Europe/Madrid";

export type ArchiveYearRangeOptions = {
  capAtNow?: boolean;
  now?: Date | string | number;
};

export type ArchiveYearRange = {
  startsAt: Date | string | number;
  endsAt: Date | string | number;
  capAtNow?: boolean;
};

const madridYearFormatter = new Intl.DateTimeFormat("en", {
  timeZone: ARCHIVE_TIME_ZONE,
  year: "numeric",
});

function parseDate(value: Date | string | number) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function getMadridYear(date: Date) {
  const year = Number(madridYearFormatter.format(date));

  return Number.isInteger(year) ? year : null;
}

export function getYearsCoveredByRange(
  startsAt: Date | string | number,
  endsAt: Date | string | number,
  options: ArchiveYearRangeOptions = {},
) {
  const start = parseDate(startsAt);
  const originalEnd = parseDate(endsAt);

  if (!start || !originalEnd) {
    return [];
  }

  let end = originalEnd;

  if (options.capAtNow) {
    const now = parseDate(options.now ?? new Date());

    if (!now) {
      return [];
    }

    if (now.getTime() < end.getTime()) {
      end = now;
    }
  }

  if (start.getTime() > end.getTime()) {
    return [];
  }

  const firstYear = getMadridYear(start);
  const lastYear = getMadridYear(end);

  if (firstYear === null || lastYear === null || firstYear > lastYear) {
    return [];
  }

  return Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => firstYear + index,
  );
}

export function getArchiveYears(
  ranges: readonly ArchiveYearRange[],
  now: Date | string | number = new Date(),
) {
  const years = new Set<number>();

  for (const range of ranges) {
    for (const year of getYearsCoveredByRange(range.startsAt, range.endsAt, {
      capAtNow: range.capAtNow,
      now,
    })) {
      years.add(year);
    }
  }

  return [...years].sort((a, b) => b - a);
}

export function rangeMatchesArchiveYear(
  startsAt: Date | string | number,
  endsAt: Date | string | number,
  year: unknown,
  options: ArchiveYearRangeOptions = {},
) {
  const normalizedYear =
    typeof year === "number" ? year : typeof year === "string" ? Number(year) : NaN;

  return (
    Number.isInteger(normalizedYear) &&
    getYearsCoveredByRange(startsAt, endsAt, options).includes(normalizedYear)
  );
}
