import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCHIVE_PATHS,
  getArchivePath,
  parseArchiveSection,
} from "../lib/archive.ts";
import {
  clampPage,
  getTotalPages,
  normalizePageSize,
  paginateItems,
} from "../lib/pagination.ts";

test("archive section accepts only the canonical values", () => {
  assert.equal(parseArchiveSection(undefined), "weeks");
  assert.equal(parseArchiveSection("weeks"), "weeks");
  assert.equal(parseArchiveSection("seasons"), "seasons");
  assert.equal(parseArchiveSection("players"), "weeks");
  assert.equal(parseArchiveSection(["seasons"]), "weeks");
  assert.equal(parseArchiveSection(["weeks", "seasons"]), "weeks");
  assert.equal(parseArchiveSection({ section: "seasons" }), "weeks");
  assert.equal(parseArchiveSection(null), "weeks");
  assert.equal(getArchivePath(undefined), "/archive/weeks");
  assert.equal(getArchivePath("weeks"), "/archive/weeks");
  assert.equal(getArchivePath("seasons"), "/archive/seasons");
  assert.equal(getArchivePath("invalid"), "/archive/weeks");
  assert.deepEqual(ARCHIVE_PATHS, {
    weeks: "/archive/weeks",
    seasons: "/archive/seasons",
  });
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
