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
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 rounded-lg border px-2 py-2.5 theme-border theme-surface-muted sm:flex sm:px-3 sm:py-3 sm:items-center sm:justify-between"
    >
      <p
        aria-live="polite"
        className="min-w-0 whitespace-nowrap text-sm font-medium tabular-nums theme-text-muted"
      >
        <span className="sr-only">
          Mostrando elementos {firstVisibleItem} a {lastVisibleItem} de {totalItems}
        </span>
        <span aria-hidden="true" className="sm:hidden">
          {firstVisibleItem}–{lastVisibleItem} de {totalItems}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">
          Mostrando {firstVisibleItem}–{lastVisibleItem} de {totalItems}
        </span>
      </p>

      <div className="contents sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
        <label className="flex min-w-0 items-center justify-end gap-2 text-sm font-medium theme-text-muted">
          <span className="sr-only">Envíos por página</span>
          <span aria-hidden="true" className="hidden sm:inline">
            Envíos por página
          </span>
          <select
            className="min-h-11 rounded-md border px-2 py-1.5 theme-input focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit sm:min-h-10"
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
          <span aria-hidden="true" className="whitespace-nowrap sm:hidden">
            por página
          </span>
        </label>

        <div className="col-span-2 grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-3 sm:flex sm:w-auto sm:gap-2">
          <button
            aria-label="Página anterior"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-lg font-bold transition theme-border theme-surface theme-text theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:min-h-10 sm:w-auto sm:min-w-10 sm:px-3"
            disabled={safePage === 1}
            onClick={() => onPageChange(safePage - 1)}
            type="button"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="whitespace-nowrap text-center text-sm font-semibold tabular-nums theme-text">
            <span className="sr-only">
              Página {safePage} de {totalPages}
            </span>
            <span aria-hidden="true" className="sm:hidden">
              {safePage} / {totalPages}
            </span>
            <span aria-hidden="true" className="hidden sm:inline">
              Página {safePage} de {totalPages}
            </span>
          </span>
          <button
            aria-label="Página siguiente"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-lg font-bold transition theme-border theme-surface theme-text theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit disabled:cursor-not-allowed disabled:opacity-40 sm:h-auto sm:min-h-10 sm:w-auto sm:min-w-10 sm:px-3"
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
