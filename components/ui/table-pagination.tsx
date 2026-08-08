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
      className="rounded-lg border px-2 py-2.5 theme-border theme-surface-muted sm:px-3 sm:py-3"
    >
      <div aria-atomic="true" aria-live="polite" className="sr-only">
        <span>
          Mostrando elementos {firstVisibleItem} a {lastVisibleItem} de {totalItems}.
        </span>{" "}
        <span>
          Página {safePage} de {totalPages}.
        </span>
      </div>

      <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3 sm:flex sm:justify-end sm:gap-2">
        <button
          aria-label="Página anterior"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-lg font-bold transition theme-border theme-surface theme-text theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-40 sm:order-3 sm:min-h-10 sm:w-auto sm:min-w-10 sm:px-3"
          disabled={safePage === 1}
          onClick={() => onPageChange(safePage - 1)}
          type="button"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <span
          aria-hidden="true"
          className="min-w-0 whitespace-nowrap text-center text-sm font-semibold tabular-nums theme-text sm:hidden"
        >
          {firstVisibleItem}–{lastVisibleItem} de {totalItems}
        </span>

        <div className="hidden items-center gap-3 text-sm font-medium theme-text-muted sm:order-1 sm:flex">
          <span aria-hidden="true" className="whitespace-nowrap tabular-nums">
            {firstVisibleItem}–{lastVisibleItem} de {totalItems}
          </span>
          <label className="flex items-center gap-2">
            <select
              aria-label="Envíos por página"
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
            <span aria-hidden="true" className="whitespace-nowrap">
              por página
            </span>
          </label>
        </div>

        <span
          aria-hidden="true"
          className="hidden whitespace-nowrap text-center text-sm font-semibold tabular-nums theme-text sm:order-4 sm:inline"
        >
          {safePage} / {totalPages}
        </span>

        <button
          aria-label="Página siguiente"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-lg font-bold transition theme-border theme-surface theme-text theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-40 sm:order-5 sm:min-h-10 sm:w-auto sm:min-w-10 sm:px-3"
          disabled={safePage === totalPages}
          onClick={() => onPageChange(safePage + 1)}
          type="button"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </nav>
  );
}
