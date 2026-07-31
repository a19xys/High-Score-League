import test from "node:test";
import assert from "node:assert/strict";
import { parseArchiveSection } from "../lib/archive.ts";
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
});

test("pagination normalizes the three supported page sizes", () => {
  assert.equal(normalizePageSize(20), 20);
  assert.equal(normalizePageSize("20"), 20);
  assert.equal(normalizePageSize(50), 50);
  assert.equal(normalizePageSize("50"), 50);
  assert.equal(normalizePageSize(100), 100);
  assert.equal(normalizePageSize("100"), 100);
  assert.equal(normalizePageSize(10), 20);
  assert.equal(normalizePageSize(101), 20);
  assert.equal(normalizePageSize("invalid"), 20);
});

test("total pages cover empty, exact and incomplete result sets", () => {
  assert.equal(getTotalPages(0, 20), 1);
  assert.equal(getTotalPages(1, 20), 1);
  assert.equal(getTotalPages(20, 20), 1);
  assert.equal(getTotalPages(21, 20), 2);
  assert.equal(getTotalPages(50, 50), 1);
  assert.equal(getTotalPages(100, 100), 1);
  assert.equal(getTotalPages(101, 100), 2);
  assert.equal(getTotalPages(101, 50), 3);
  assert.equal(getTotalPages(21, 17), 2);
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
  const items = Array.from({ length: 101 }, (_, index) => index + 1);

  assert.deepEqual(paginateItems(items, 1, 20), items.slice(0, 20));
  assert.deepEqual(paginateItems(items, 3, 20), items.slice(40, 60));
  assert.deepEqual(paginateItems(items, 6, 20), [101]);
  assert.deepEqual(paginateItems(items, 2, 50), items.slice(50, 100));
  assert.deepEqual(paginateItems(items, 2, 100), [101]);
  assert.deepEqual(paginateItems(items, -1, 20), items.slice(0, 20));
  assert.deepEqual(paginateItems(items, 99, 20), [101]);
});

test("changing page size recalculates the valid page", () => {
  const items = Array.from({ length: 101 }, (_, index) => index + 1);

  assert.deepEqual(paginateItems(items, 6, 20), [101]);
  assert.deepEqual(paginateItems(items, 1, 50), items.slice(0, 50));
  assert.deepEqual(paginateItems(items, 1, 100), items.slice(0, 100));
});

test("sorting the complete set before pagination preserves global order", () => {
  const unsorted = [9, 1, 7, 2, 8, 3, 6, 4, 5];
  const globallySorted = unsorted.toSorted((a, b) => b - a);

  assert.deepEqual(paginateItems(globallySorted, 1, 20), [9, 8, 7, 6, 5, 4, 3, 2, 1]);

  const largerSet = Array.from({ length: 21 }, (_, index) => index + 1);
  const sortedDescending = largerSet.toSorted((a, b) => b - a);

  assert.deepEqual(paginateItems(sortedDescending, 2, 20), [1]);
});
