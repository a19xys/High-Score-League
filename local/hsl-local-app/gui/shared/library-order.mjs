export function normalizeSortBy(value) {
  return ["weeks", "title", "developer", "year"].includes(value) ? value : "weeks";
}

export function normalizeSortDirection(value) {
  return value === "desc" ? "desc" : "asc";
}

export function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "es", {
    numeric: true,
    sensitivity: "base",
  });
}

export function normalizedYear(pack) {
  const year = Number(pack?.year);
  return Number.isInteger(year) && year > 0 ? String(year) : null;
}

export function yearNumber(pack) {
  const year = normalizedYear(pack);
  return year ? Number(year) : null;
}

function firstNonEmpty(value) {
  if (Array.isArray(value)) {
    return value.map(firstNonEmpty).find(Boolean) || null;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  return String(value)
    .split(/[·,;]/u)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .find(Boolean) || null;
}

export function primaryDeveloper(pack) {
  return firstNonEmpty(pack?.developer) || firstNonEmpty(pack?.publisher);
}

function compareWeeks(a, b) {
  const left = [
    a?.seasonName || a?.seasonId || "",
    Number.isFinite(Number(a?.weekNumber)) ? Number(a.weekNumber) : Number.MAX_SAFE_INTEGER,
    a?.weekId || "",
    a?.title || "",
  ];
  const right = [
    b?.seasonName || b?.seasonId || "",
    Number.isFinite(Number(b?.weekNumber)) ? Number(b.weekNumber) : Number.MAX_SAFE_INTEGER,
    b?.weekId || "",
    b?.title || "",
  ];
  const season = compareText(left[0], right[0]);
  if (season) return season;
  if (left[1] !== right[1]) return left[1] - right[1];
  const week = compareText(left[2], right[2]);
  return week || compareText(left[3], right[3]);
}

export function comparePacks(a, b, sortBy) {
  if (sortBy === "developer") {
    const developer = compareText(primaryDeveloper(a) || a?.title, primaryDeveloper(b) || b?.title);
    return developer || compareText(a?.title, b?.title);
  }

  if (sortBy === "year") {
    const left = yearNumber(a) ?? Number.MAX_SAFE_INTEGER;
    const right = yearNumber(b) ?? Number.MAX_SAFE_INTEGER;
    return left === right ? compareText(a?.title, b?.title) : left - right;
  }

  return sortBy === "weeks" ? compareWeeks(a, b) : compareText(a?.title, b?.title);
}

export function sortPacks(packs, state = {}) {
  const sortBy = normalizeSortBy(state.librarySortBy);
  const direction = normalizeSortDirection(state.librarySortDirection);
  const factor = direction === "desc" ? -1 : 1;

  if (sortBy === "year") {
    return [...packs].sort((a, b) => {
      const leftYear = yearNumber(a);
      const rightYear = yearNumber(b);
      const leftHasYear = Number.isFinite(leftYear);
      const rightHasYear = Number.isFinite(rightYear);

      if (leftHasYear && rightHasYear && leftYear !== rightYear) {
        return (leftYear - rightYear) * factor;
      }
      if (leftHasYear !== rightHasYear) {
        return leftHasYear ? -1 : 1;
      }
      return compareText(a?.title, b?.title) * factor;
    });
  }

  if (sortBy === "developer") {
    return [...packs].sort((a, b) => {
      const leftDeveloper = primaryDeveloper(a);
      const rightDeveloper = primaryDeveloper(b);

      if (leftDeveloper && rightDeveloper) {
        const developer = compareText(leftDeveloper, rightDeveloper);
        if (developer) return developer * factor;
      }
      if (Boolean(leftDeveloper) !== Boolean(rightDeveloper)) {
        return leftDeveloper ? -1 : 1;
      }
      return compareText(a?.title, b?.title);
    });
  }

  return [...packs].sort((a, b) => comparePacks(a, b, sortBy) * factor);
}
