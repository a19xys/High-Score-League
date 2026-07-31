export const TABLE_PAGE_SIZES = [10, 25, 50] as const;

export type TablePageSize = (typeof TABLE_PAGE_SIZES)[number];

export function normalizePageSize(value: unknown): TablePageSize {
  const numericValue =
    typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : value;

  return TABLE_PAGE_SIZES.includes(numericValue as TablePageSize)
    ? (numericValue as TablePageSize)
    : 10;
}

export function getTotalPages(totalItems: number, pageSize: unknown): number {
  const safeTotal = Number.isFinite(totalItems)
    ? Math.max(0, Math.floor(totalItems))
    : 0;

  return Math.max(1, Math.ceil(safeTotal / normalizePageSize(pageSize)));
}

export function clampPage(page: number, totalPages: number): number {
  const safeTotalPages = Number.isFinite(totalPages)
    ? Math.max(1, Math.floor(totalPages))
    : 1;
  const safePage = Number.isFinite(page) ? Math.floor(page) : 1;

  return Math.min(Math.max(1, safePage), safeTotalPages);
}

export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: unknown,
): T[] {
  const safePageSize = normalizePageSize(pageSize);
  const safePage = clampPage(page, getTotalPages(items.length, safePageSize));
  const startIndex = (safePage - 1) * safePageSize;

  return items.slice(startIndex, startIndex + safePageSize);
}
