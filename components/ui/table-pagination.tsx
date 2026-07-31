"use client";

import {
  clampPage,
  getTotalPages,
  normalizePageSize,
  TABLE_PAGE_SIZES,
  type TablePageSize,
} from "@/lib/pagination";

type TablePaginationProps = {
  page: number;
  pageSize: TablePageSize;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: TablePageSize) => void;
};

export function TablePagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  if (totalItems <= TABLE_PAGE_SIZES[0]) {
    return null;
  }

  const totalPages = getTotalPages(totalItems, pageSize);
  const safePage = clampPage(page, totalPages);
  const firstVisibleItem = (safePage - 1) * pageSize + 1;
  const lastVisibleItem = Math.min(safePage * pageSize, totalItems);

  return (
    <nav
      aria-label="Paginación de la tabla"
      className="flex flex-col gap-3 rounded-lg border px-3 py-3 theme-border theme-surface-muted sm:flex-row sm:items-center sm:justify-between"
    >
      <p
        aria-live="polite"
        className="text-sm font-medium tabular-nums theme-text-muted"
      >
        Mostrando {firstVisibleItem}–{lastVisibleItem} de {totalItems}
      </p>

      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <label className="flex min-w-0 items-center gap-2 text-sm font-medium theme-text-muted">
          <span>Envíos por página</span>
          <select
            className="min-h-10 rounded-md border px-2 py-1.5 theme-input focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
            onChange={(event) =>
              onPageSizeChange(normalizePageSize(event.target.value))
            }
            value={pageSize}
          >
            {TABLE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            aria-label="Página anterior"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border px-3 text-lg font-bold transition theme-border theme-surface theme-text theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage === 1}
            onClick={() => onPageChange(safePage - 1)}
            type="button"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="whitespace-nowrap text-sm font-semibold tabular-nums theme-text">
            Página {safePage} de {totalPages}
          </span>
          <button
            aria-label="Página siguiente"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border px-3 text-lg font-bold transition theme-border theme-surface theme-text theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage === totalPages}
            onClick={() => onPageChange(safePage + 1)}
            type="button"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
