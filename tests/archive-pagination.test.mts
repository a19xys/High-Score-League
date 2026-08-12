import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ARCHIVE_PATHS,
  getArchivePath,
  parseArchiveSection,
  resolveArchiveSection,
} from "../lib/archive.ts";
import {
  getArchiveYears,
  getYearsCoveredByRange,
  rangeMatchesArchiveYear,
} from "../lib/archive-years.ts";
import {
  clampPage,
  getEmptyPageSlotCount,
  getTotalPages,
  normalizePageSize,
  paginateItems,
} from "../lib/pagination.ts";
import {
  cancelDocumentScrollFrame,
  captureDocumentScrollTop,
  restoreDocumentScrollTop,
  verifyDocumentScrollTopOnNextFrame,
  type DocumentScrollRuntime,
} from "../lib/document-scroll-restoration.ts";

test("archive section accepts only the canonical values", () => {
  assert.equal(parseArchiveSection(undefined), null);
  assert.equal(parseArchiveSection("weeks"), "weeks");
  assert.equal(parseArchiveSection("seasons"), "seasons");
  assert.equal(parseArchiveSection("players"), null);
  assert.equal(parseArchiveSection(["seasons"]), null);
  assert.equal(parseArchiveSection(["weeks", "seasons"]), null);
  assert.equal(parseArchiveSection({ section: "seasons" }), null);
  assert.equal(parseArchiveSection(null), null);
  assert.equal(getArchivePath(undefined), "/archive#weeks");
  assert.equal(getArchivePath("weeks"), "/archive#weeks");
  assert.equal(getArchivePath("seasons"), "/archive#seasons");
  assert.equal(getArchivePath("invalid"), "/archive#weeks");
  assert.equal(resolveArchiveSection(""), "weeks");
  assert.equal(resolveArchiveSection("#weeks"), "weeks");
  assert.equal(resolveArchiveSection("#seasons"), "seasons");
  assert.equal(resolveArchiveSection("#tomate"), "weeks");
  assert.deepEqual(ARCHIVE_PATHS, {
    weeks: "/archive#weeks",
    seasons: "/archive#seasons",
  });
});

test("archive years cover a single year and every year crossed by a range", () => {
  assert.deepEqual(
    getYearsCoveredByRange("2026-02-01T00:00:00Z", "2026-11-30T23:00:00Z"),
    [2026],
  );
  assert.deepEqual(
    getYearsCoveredByRange("2025-12-28T00:00:00Z", "2026-01-03T23:00:00Z"),
    [2025, 2026],
  );
});

test("active archive ranges stop at today and never expose future years", () => {
  assert.deepEqual(
    getYearsCoveredByRange("2026-12-28T00:00:00Z", "2027-01-08T00:00:00Z", {
      capAtNow: true,
      now: "2026-12-30T12:00:00Z",
    }),
    [2026],
  );
  assert.deepEqual(
    getYearsCoveredByRange("2027-01-02T00:00:00Z", "2027-01-08T00:00:00Z", {
      capAtNow: true,
      now: "2026-12-30T12:00:00Z",
    }),
    [],
  );
});

test("archive year options are unique and sorted from newest to oldest", () => {
  assert.deepEqual(
    getArchiveYears(
      [
        { startsAt: "2024-05-01T00:00:00Z", endsAt: "2024-05-07T00:00:00Z" },
        { startsAt: "2025-12-28T00:00:00Z", endsAt: "2026-01-03T00:00:00Z" },
        { startsAt: "2025-03-01T00:00:00Z", endsAt: "2025-04-01T00:00:00Z" },
      ],
      "2026-06-01T00:00:00Z",
    ),
    [2026, 2025, 2024],
  );
});

test("archive years use the Madrid calendar at a UTC year boundary", () => {
  assert.deepEqual(
    getYearsCoveredByRange("2025-12-31T22:30:00Z", "2025-12-31T23:30:00Z"),
    [2025, 2026],
  );
});

test("archive year helpers reject invalid ranges safely", () => {
  assert.deepEqual(getYearsCoveredByRange("invalid", "2026-01-01"), []);
  assert.deepEqual(getYearsCoveredByRange("2026-02-01", "2026-01-01"), []);
  assert.equal(rangeMatchesArchiveYear("invalid", "2026-01-01", 2026), false);
  assert.equal(rangeMatchesArchiveYear("2025-12-28", "2026-01-03", "invalid"), false);
});

test("archive ranges match both sides of a cross-year interval", () => {
  assert.equal(rangeMatchesArchiveYear("2025-12-28", "2026-01-03", 2025), true);
  assert.equal(rangeMatchesArchiveYear("2025-12-28", "2026-01-03", "2026"), true);
  assert.equal(rangeMatchesArchiveYear("2025-12-28", "2026-01-03", 2024), false);
});

test("archive root is a protected, fully mounted hash workspace", async () => {
  const root = process.cwd();
  const [pageSource, switcherSource, weeksLegacy, seasonsLegacy, navSource] = await Promise.all([
    readFile(join(root, "app", "archive", "page.tsx"), "utf8"),
    readFile(join(root, "components", "archive", "archive-section-switcher.tsx"), "utf8"),
    readFile(join(root, "app", "archive", "weeks", "page.tsx"), "utf8"),
    readFile(join(root, "app", "archive", "seasons", "page.tsx"), "utf8"),
    readFile(join(root, "components", "site-nav-client.tsx"), "utf8"),
  ]);

  assert.match(pageSource, /hasServerSession/);
  assert.match(pageSource, /section !== undefined/);
  assert.match(pageSource, /Promise\.all\(\[/);
  assert.match(pageSource, /getWeekPageData\(\)/);
  assert.match(pageSource, /getSeasonPageData\(\)/);
  assert.match(pageSource, /id: "weeks"[\s\S]*id: "seasons"/);
  assert.match(switcherSource, /useState<ArchiveSection>\("weeks"\)/);
  assert.match(switcherSource, /resolveArchiveSection\(window\.location\.hash\)/);
  assert.match(switcherSource, /window\.history\.replaceState/);
  assert.match(switcherSource, /hidden=\{panel\.id !== activeSection\}/);
  assert.doesNotMatch(switcherSource, /router\.|next\/navigation|fetch\(/);
  assert.match(weeksLegacy, /permanentRedirect\("\/archive#weeks"\)/);
  assert.match(seasonsLegacy, /permanentRedirect\("\/archive#seasons"\)/);
  assert.match(navSource, /href: "\/archive#weeks", label: "ARCHIVO"/);
  await assert.rejects(readFile(join(root, "components", "archive", "archive-layout.tsx")));
  await assert.rejects(readFile(join(root, "components", "archive", "archive-navigation.tsx")));
});

test("archive and detail breadcrumbs omit the old Archivo level", async () => {
  const [switcher, weekDetail, seasonDetail] = await Promise.all([
    readFile(join(process.cwd(), "components", "archive", "archive-section-switcher.tsx"), "utf8"),
    readFile(join(process.cwd(), "app", "weeks", "[weekId]", "page.tsx"), "utf8"),
    readFile(join(process.cwd(), "app", "seasons", "[seasonId]", "page.tsx"), "utf8"),
  ]);

  for (const source of [switcher, weekDetail, seasonDetail]) {
    assert.doesNotMatch(source, /label: "Archivo"/);
  }
  assert.match(weekDetail, /href: "\/archive#weeks", label: "Semanas"/);
  assert.match(seasonDetail, /href: "\/archive#seasons", label: "Temporadas"/);
});

test("table pagination keeps a compact mobile row and a truly centered desktop row", async () => {
  const source = await readFile(
    join(process.cwd(), "components", "ui", "table-pagination.tsx"),
    "utf8",
  );

  assert.match(source, /grid-cols-\[2\.75rem_minmax\(0,1fr\)_2\.75rem\]/);
  assert.match(
    source,
    /sm:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/,
  );
  assert.match(source, /aria-label="Envíos por página"/);
  assert.match(source, /className="hidden items-center justify-self-end[^\n]+sm:flex"/);
  assert.doesNotMatch(source, /\{safePage\} \/ \{totalPages\}/);
});

test("empty page slots preserve the selected page size without inventing data", () => {
  assert.equal(getEmptyPageSlotCount(24, 10, 10), 0);
  assert.equal(getEmptyPageSlotCount(24, 4, 10), 6);
  assert.equal(getEmptyPageSlotCount(39, 14, 25), 11);
  assert.equal(getEmptyPageSlotCount(4, 4, 10), 6);
  assert.equal(getEmptyPageSlotCount(0, 0, 10), 0);
});

test("empty submission rows are inaccessible presentation-only table rows", async () => {
  const source = await readFile(
    join(process.cwd(), "components", "submissions-table.tsx"),
    "utf8",
  );
  const rowSource = source.slice(
    source.indexOf("function EmptySubmissionRow"),
    source.indexOf("export function SubmissionsTable"),
  );

  assert.match(rowSource, /<tr aria-hidden="true" className=\{rowClassName\}>/);
  assert.match(rowSource, /showWeek \? <td/);
  assert.match(rowSource, /<td/g);
  assert.doesNotMatch(
    rowSource,
    /theme-hover|<Link|<button|tabIndex|aria-label|role=/,
  );
  assert.match(source, /Array\.from\(\{ length: emptyRowCount \}/);
});

test("submissions mobile layout has no date col track and localizes scroll anchoring", async () => {
  const [source, styles] = await Promise.all([
    readFile(join(process.cwd(), "components", "submissions-table.tsx"), "utf8"),
    readFile(join(process.cwd(), "app", "globals.css"), "utf8"),
  ]);
  const columns = source.slice(
    source.indexOf("function SubmissionColumns"),
    source.indexOf("function EmptySubmissionRow"),
  );

  assert.match(columns, /<colgroup>/);
  assert.match(columns, /submission-col-week/);
  assert.match(columns, /submission-col-attempt/);
  assert.match(columns, /submission-col-score/);
  assert.doesNotMatch(columns, /submission-col-date/);
  assert.doesNotMatch(styles, /\.submission-col-date/);
  assert.match(styles, /\.submissions-table-region\s*\{\s*overflow-anchor:\s*none/);
});

test("document scroll restoration keeps the exact coordinate instant and verifies once", () => {
  let currentScrollTop = 843.5;
  let completed = 0;
  let canceledFrame: number | null = null;
  const assignments: Array<{ behavior: string; scrollTop: number }> = [];
  const queuedFrames: Array<() => void> = [];
  const style = { scrollBehavior: "smooth" };
  const scrollingElement = {
    style,
    get scrollTop() {
      return currentScrollTop;
    },
    set scrollTop(value: number) {
      assignments.push({ behavior: style.scrollBehavior, scrollTop: value });
      currentScrollTop = value;
    },
  };
  const runtime: DocumentScrollRuntime = {
    cancelFrame(frameId) {
      canceledFrame = frameId;
    },
    getScrollingElement() {
      return scrollingElement;
    },
    requestFrame(callback) {
      queuedFrames.push(callback);
      return 17;
    },
  };

  assert.equal(captureDocumentScrollTop(runtime), 843.5);

  currentScrollTop = 120;
  restoreDocumentScrollTop(843.5, runtime);
  assert.equal(currentScrollTop, 843.5);
  assert.equal(style.scrollBehavior, "smooth");

  const frameId = verifyDocumentScrollTopOnNextFrame(
    843.5,
    () => {
      completed += 1;
    },
    runtime,
  );
  assert.equal(frameId, 17);
  assert.equal(queuedFrames.length, 1);

  currentScrollTop = 431.25;
  queuedFrames[0]();
  assert.equal(currentScrollTop, 843.5);
  assert.equal(completed, 1);
  assert.equal(queuedFrames.length, 1);
  assert.deepEqual(assignments, [
    { behavior: "auto", scrollTop: 843.5 },
    { behavior: "auto", scrollTop: 843.5 },
  ]);

  cancelDocumentScrollFrame(frameId, runtime);
  assert.equal(canceledFrame, 17);
});

test("submission pagination and sorting share the exact pending scroll invariant", async () => {
  const [source, helper] = await Promise.all([
    readFile(join(process.cwd(), "components", "submissions-table.tsx"), "utf8"),
    readFile(join(process.cwd(), "lib", "document-scroll-restoration.ts"), "utf8"),
  ]);
  const preparation = source.slice(
    source.indexOf("function prepareTableScrollRestore"),
    source.indexOf("function changePagePreservingScroll"),
  );
  const pageHandler = source.slice(
    source.indexOf("function changePagePreservingScroll"),
    source.indexOf("useLayoutEffect", source.indexOf("function changePagePreservingScroll")),
  );
  const layoutEffect = source.slice(
    source.indexOf("useLayoutEffect", source.indexOf("function changePagePreservingScroll")),
    source.indexOf("useEffect", source.indexOf("useLayoutEffect", source.indexOf("function changePagePreservingScroll"))),
  );
  const verification = helper.slice(
    helper.indexOf("export function verifyDocumentScrollTopOnNextFrame"),
    helper.indexOf("export function cancelDocumentScrollFrame"),
  );

  const sortHandler = source.slice(
    source.indexOf("function toggleSort"),
    source.indexOf("const hasOwnHiddenScores"),
  );

  assert.match(preparation, /cancelPendingTableScrollFrame\(\);[\s\S]*pendingTableScrollTopRef\.current = captureDocumentScrollTop\(\)/);
  assert.ok(pageHandler.indexOf("prepareTableScrollRestore()") < pageHandler.indexOf("setPage(nextPage)"));
  assert.match(source, /onPageChange=\{changePagePreservingScroll\}/);
  assert.doesNotMatch(source, /onPageChange=\{setPage\}/);
  assert.match(layoutEffect, /const savedScrollTop = pendingTableScrollTopRef\.current/);
  assert.match(layoutEffect, /if \(savedScrollTop === null\) \{\s*return;/);
  assert.match(layoutEffect, /restoreDocumentScrollTop\(savedScrollTop\)/);
  assert.match(layoutEffect, /verifyDocumentScrollTopOnNextFrame/);
  assert.match(layoutEffect, /return cancelPendingTableScrollFrame/);
  assert.match(layoutEffect, /safePage, sortDirection, sortKey/);
  assert.ok(sortHandler.indexOf("prepareTableScrollRestore()") < sortHandler.indexOf("setPage(1)"));
  assert.match(sortHandler, /nextSortKey === sortKey[\s\S]*setSortDirection\(\(current\) => \(current === "asc" \? "desc" : "asc"\)\)/);
  for (const key of ["attempt", "score", "submittedAt"]) {
    assert.match(source, new RegExp(`onClick=\\{\\(\\) => toggleSort\\("${key}"\\)\\}`));
  }
  assert.doesNotMatch(sortHandler, /clearPendingTableScrollRestore/);
  assert.match(source, /onPageSizeChange=\{\(nextPageSize\) => \{\s*clearPendingTableScrollRestore\(\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*clearPendingTableScrollRestore\(\);\s*setPage\(1\);\s*\}, \[clearPendingTableScrollRestore, resetKey\]\)/);
  assert.match(helper, /document\.scrollingElement/);
  assert.match(helper, /scrollBehavior = "auto"/);
  assert.equal(verification.match(/runtime\.requestFrame\(/g)?.length, 1);
  assert.doesNotMatch(`${source}\n${helper}`, /setTimeout|setInterval|scrollIntoView|window\.innerWidth|navigator\.userAgent/);
});

test("submission player identity uses one compact avatar representation at every width", async () => {
  const [source, styles, playerPill, weekDetail, profileHistory, validation] = await Promise.all([
    readFile(join(process.cwd(), "components", "submissions-table.tsx"), "utf8"),
    readFile(join(process.cwd(), "app", "globals.css"), "utf8"),
    readFile(join(process.cwd(), "components", "player-pill.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "week-detail-view.tsx"), "utf8"),
    readFile(join(process.cwd(), "components", "profile", "profile-submissions-history.tsx"), "utf8"),
    readFile(join(process.cwd(), "lib", "auth", "validation.ts"), "utf8"),
  ]);

  assert.match(
    source,
    /showPlayer && submission\.player \? \(\s*<PlayerPill\s+player=\{submission\.player\}\s+variant="submission"/,
  );
  assert.equal(source.match(/variant="submission"/g)?.length, 1);
  assert.doesNotMatch(`${source}\n${styles}`, /submission-player-rich|submission-player-compact/);
  assert.match(playerPill, /size=\{isSubmission \? "submission" : "pill"\}/);
  assert.doesNotMatch(playerPill, /isSubmission[^\n]+hidden|hidden[^\n]+isSubmission/);
  assert.match(validation, /initialsPattern = \/\^\[A-Z0-9\]\{3\}\$\//);
  assert.match(weekDetail, /<SubmissionsTable[\s\S]*?showWeek=\{false\}/);
  assert.doesNotMatch(weekDetail, /showPlayer=\{false\}/);
  assert.match(profileHistory, /<SubmissionsTable[\s\S]*?showPlayer=\{false\}/);
});

test("pagination normalizes the three supported page sizes", () => {
  assert.equal(normalizePageSize(10), 10);
  assert.equal(normalizePageSize("10"), 10);
  assert.equal(normalizePageSize(25), 25);
  assert.equal(normalizePageSize("25"), 25);
  assert.equal(normalizePageSize(50), 50);
  assert.equal(normalizePageSize("50"), 50);
  assert.equal(normalizePageSize(20), 10);
  assert.equal(normalizePageSize(100), 10);
  assert.equal(normalizePageSize(51), 10);
  assert.equal(normalizePageSize("invalid"), 10);
});

test("total pages cover empty, exact and incomplete result sets", () => {
  assert.equal(getTotalPages(0, 10), 1);
  assert.equal(getTotalPages(1, 10), 1);
  assert.equal(getTotalPages(10, 10), 1);
  assert.equal(getTotalPages(11, 10), 2);
  assert.equal(getTotalPages(25, 25), 1);
  assert.equal(getTotalPages(26, 25), 2);
  assert.equal(getTotalPages(50, 50), 1);
  assert.equal(getTotalPages(51, 50), 2);
  assert.equal(getTotalPages(11, 17), 2);
});

test("page clamping prevents invalid navigation", () => {
  assert.equal(clampPage(-4, 5), 1);
  assert.equal(clampPage(0, 5), 1);
  assert.equal(clampPage(3, 5), 3);
  assert.equal(clampPage(9, 5), 5);
  assert.equal(clampPage(Number.NaN, 5), 1);
  assert.equal(clampPage(2, 0), 1);
});

test("pagination returns first, intermediate and incomplete final pages", () => {
  const items = Array.from({ length: 51 }, (_, index) => index + 1);

  assert.deepEqual(paginateItems(items, 1, 10), items.slice(0, 10));
  assert.deepEqual(paginateItems(items, 3, 10), items.slice(20, 30));
  assert.deepEqual(paginateItems(items, 6, 10), [51]);
  assert.deepEqual(paginateItems(items, 2, 25), items.slice(25, 50));
  assert.deepEqual(paginateItems(items, 2, 50), [51]);
  assert.deepEqual(paginateItems(items, -1, 10), items.slice(0, 10));
  assert.deepEqual(paginateItems(items, 99, 10), [51]);
});

test("twenty-four items paginate as ten, ten and four real submissions", () => {
  const items = Array.from({ length: 24 }, (_, index) => index + 1);

  assert.equal(paginateItems(items, 1, 10).length, 10);
  assert.equal(paginateItems(items, 2, 10).length, 10);
  assert.deepEqual(paginateItems(items, 3, 10), [21, 22, 23, 24]);
});

test("changing page size recalculates the valid page", () => {
  const items = Array.from({ length: 51 }, (_, index) => index + 1);

  assert.deepEqual(paginateItems(items, 6, 10), [51]);
  assert.deepEqual(paginateItems(items, 1, 25), items.slice(0, 25));
  assert.deepEqual(paginateItems(items, 1, 50), items.slice(0, 50));
});

test("sorting the complete set before pagination preserves global order", () => {
  const unsorted = [9, 1, 7, 2, 8, 3, 6, 4, 5];
  const globallySorted = unsorted.toSorted((a, b) => b - a);

  assert.deepEqual(paginateItems(globallySorted, 1, 10), [9, 8, 7, 6, 5, 4, 3, 2, 1]);

  const largerSet = Array.from({ length: 11 }, (_, index) => index + 1);
  const sortedDescending = largerSet.toSorted((a, b) => b - a);

  assert.deepEqual(paginateItems(sortedDescending, 2, 10), [1]);
});
