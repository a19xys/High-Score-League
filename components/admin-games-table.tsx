"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { GameRow } from "@/types/supabase";
import { EmptyState } from "./ui/state";

type AdminGamesTableProps = {
  games: GameRow[];
};

type FilterKey = "year" | "developer" | "publisher" | "genre";
type SortKey = "year" | "title";
type SortDirection = "asc" | "desc";
type SortState = {
  key: SortKey;
  direction: SortDirection;
};

type Filters = Record<FilterKey, string>;

const emptyFilters: Filters = {
  year: "",
  developer: "",
  publisher: "",
  genre: "",
};

function normalizeText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).join(" ");
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function getFilterValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item).trim()).filter(Boolean);
  }

  const normalized = normalizeText(value).trim();
  return normalized ? [normalized] : [];
}

function getUniqueOptions(games: GameRow[], key: FilterKey): string[] {
  const options = new Set<string>();

  for (const game of games) {
    const value =
      key === "year"
        ? game.year
        : key === "developer"
          ? game.developers
          : key === "publisher"
            ? game.publishers
            : [...game.genres, ...game.themes, ...game.perspectives];

    for (const option of getFilterValues(value)) {
      options.add(option);
    }
  }

  return Array.from(options).sort((a, b) =>
    a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }),
  );
}

function matchesSearch(game: GameRow, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  const haystack = [
    game.title,
    game.year,
    game.developers,
    game.publishers,
    game.perspectives,
    game.themes,
    game.genres,
    game.rom_name,
    game.notes,
    game.instructions,
  ]
    .map(normalizeText)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function matchesFilter(game: GameRow, key: FilterKey, selected: string) {
  if (!selected) {
    return true;
  }

  const value =
    key === "year"
      ? game.year
      : key === "developer"
        ? game.developers
        : key === "publisher"
          ? game.publishers
          : [...game.genres, ...game.themes, ...game.perspectives];
  return getFilterValues(value).some((option) => option === selected);
}

function hasActiveFilters(filters: Filters) {
  return Object.values(filters).some(Boolean);
}

function compareTitles(a: GameRow, b: GameRow, direction: SortDirection) {
  const result = a.title.localeCompare(b.title, "es", {
    numeric: true,
    sensitivity: "base",
  });

  return direction === "asc" ? result : -result;
}

function compareYears(a: GameRow, b: GameRow, direction: SortDirection) {
  const aYear = typeof a.year === "number" ? a.year : null;
  const bYear = typeof b.year === "number" ? b.year : null;
  const aHasYear = aYear !== null;
  const bHasYear = bYear !== null;

  if (!aHasYear && !bHasYear) {
    return compareTitles(a, b, "asc");
  }

  if (!aHasYear) {
    return 1;
  }

  if (!bHasYear) {
    return -1;
  }

  const result = aYear - bYear;

  if (result !== 0) {
    return direction === "asc" ? result : -result;
  }

  return compareTitles(a, b, "asc");
}

function sortGames(games: GameRow[], sort: SortState) {
  return [...games].sort((a, b) => {
    if (sort.key === "title") {
      return compareTitles(a, b, sort.direction);
    }

    return compareYears(a, b, sort.direction);
  });
}

function rowGridClass() {
  return "grid grid-cols-[minmax(0,1fr)_4.25rem] md:grid-cols-[minmax(0,1.3fr)_4.25rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.45fr)_4.25rem]";
}

function cellClass(extra = "") {
  return `min-w-0 overflow-hidden px-3 py-3 ${extra}`;
}

function MeasuredTagList({
  values,
  emptyLabel = "-",
}: {
  values: string[];
  emptyLabel?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const normalizedValues = values.map((value) => value.trim()).filter(Boolean);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (normalizedValues.length === 0) {
      setVisibleCount(0);
      return;
    }

    const measurer = measureRef.current;

    if (!measurer || containerWidth <= 0) {
      setVisibleCount(Math.min(normalizedValues.length, 1));
      return;
    }

    const gap = 4;
    const chipWidths = normalizedValues.map((_, index) => {
      const chip = measurer.querySelector<HTMLElement>(
        `[data-chip-index="${index}"]`,
      );
      return chip?.offsetWidth ?? 0;
    });
    const moreChipWidth =
      measurer.querySelector<HTMLElement>("[data-more-chip]")?.offsetWidth ?? 0;

    let nextVisibleCount = 0;

    for (let count = normalizedValues.length; count >= 0; count -= 1) {
      const hiddenCount = normalizedValues.length - count;
      const visibleWidth = chipWidths
        .slice(0, count)
        .reduce((total, width) => total + width, 0);
      const chipCount = count + (hiddenCount > 0 ? 1 : 0);
      const totalWidth =
        visibleWidth +
        Math.max(0, chipCount - 1) * gap +
        (hiddenCount > 0 ? moreChipWidth : 0);

      if (totalWidth <= containerWidth) {
        nextVisibleCount = count;
        break;
      }
    }

    setVisibleCount(nextVisibleCount);
  }, [containerWidth, normalizedValues.join("\u0000"), normalizedValues.length]);

  if (normalizedValues.length === 0) {
    return <span className="theme-text-muted">{emptyLabel}</span>;
  }

  const fullTitle = normalizedValues.join(" · ");
  const safeVisibleCount =
    visibleCount === 0 && containerWidth > 0
      ? 0
      : Math.min(visibleCount || 1, normalizedValues.length);
  const visibleValues = normalizedValues.slice(0, safeVisibleCount);
  const hiddenCount = normalizedValues.length - safeVisibleCount;

  return (
    <span
      className="relative block min-w-0 overflow-hidden whitespace-nowrap"
      ref={containerRef}
      title={fullTitle}
    >
      <span className="flex min-w-0 max-w-full flex-nowrap items-center gap-1 overflow-hidden whitespace-nowrap">
        {visibleValues.map((item) => (
          <span
            className="inline-block max-w-[8rem] shrink-0 truncate rounded-full border px-2 py-0.5 text-xs theme-border theme-surface-muted theme-text-muted"
            key={item}
            title={item}
          >
            {item}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span
            className="inline-block shrink-0 rounded-full border px-2 py-0.5 text-xs theme-border theme-text-muted"
            title={fullTitle}
          >
            +{hiddenCount}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden
        className="pointer-events-none fixed -left-[9999px] top-0 flex flex-nowrap gap-1 whitespace-nowrap opacity-0"
        ref={measureRef}
      >
        {normalizedValues.map((item, index) => (
          <span
            className="inline-block max-w-[8rem] shrink-0 truncate rounded-full border px-2 py-0.5 text-xs theme-border theme-surface-muted theme-text-muted"
            data-chip-index={index}
            key={item}
          >
            {item}
          </span>
        ))}
        <span
          className="inline-block shrink-0 rounded-full border px-2 py-0.5 text-xs theme-border theme-text-muted"
          data-more-chip
        >
          +99
        </span>
      </span>
    </span>
  );
}

function renderTagValue(value: string | string[] | number | null | undefined) {
  return <MeasuredTagList values={getFilterValues(value)} />;
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold theme-text">{label}</span>
      <select
        className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AdminGamesTable({ games }: AdminGamesTableProps) {
  const [search, setSearch] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<SortState>({
    key: "year",
    direction: "asc",
  });

  const filterOptions = useMemo(
    () => ({
      year: getUniqueOptions(games, "year"),
      developer: getUniqueOptions(games, "developer"),
      publisher: getUniqueOptions(games, "publisher"),
      genre: getUniqueOptions(games, "genre"),
    }),
    [games],
  );

  const visibleGames = useMemo(
    () =>
      sortGames(
        games.filter(
          (game) =>
            matchesSearch(game, search) &&
            matchesFilter(game, "year", filters.year) &&
            matchesFilter(game, "developer", filters.developer) &&
            matchesFilter(game, "publisher", filters.publisher) &&
            matchesFilter(game, "genre", filters.genre),
        ),
        sort,
      ),
    [filters, games, search, sort],
  );

  function updateFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (current.key !== key) {
        return { key, direction: "asc" };
      }

      return {
        key,
        direction: current.direction === "asc" ? "desc" : "asc",
      };
    });
  }

  function sortIndicator(key: SortKey) {
    if (sort.key !== key) {
      return "";
    }

    return sort.direction === "asc" ? " ↑" : " ↓";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="block w-full max-w-2xl">
          <span className="text-sm font-semibold theme-text">Buscar juego</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Escribe aquí..."
            value={search}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border px-3 py-3 text-sm font-semibold theme-border theme-hover theme-text"
            onClick={() => setShowAdvancedFilters((current) => !current)}
            type="button"
          >
            Más filtros
          </button>
          {hasActiveFilters(filters) ? (
            <button
              className="rounded-md border px-3 py-3 text-sm font-semibold theme-border theme-hover theme-text"
              onClick={() => setFilters(emptyFilters)}
              type="button"
            >
              Borrar filtros
            </button>
          ) : null}
          <Link
            className="rounded-md bg-circuit px-3 py-3 text-sm font-semibold text-white"
            href="/admin/games/new"
          >
            Crear juego
          </Link>
        </div>
      </div>

      {showAdvancedFilters ? (
        <div className="grid gap-3 rounded-lg border p-4 theme-border theme-surface-muted md:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            label="Año"
            onChange={(value) => updateFilter("year", value)}
            options={filterOptions.year}
            value={filters.year}
          />
          <FilterSelect
            label="Género"
            onChange={(value) => updateFilter("genre", value)}
            options={filterOptions.genre}
            value={filters.genre}
          />
          <FilterSelect
            label="Desarrollador"
            onChange={(value) => updateFilter("developer", value)}
            options={filterOptions.developer}
            value={filters.developer}
          />
          <FilterSelect
            label="Editor"
            onChange={(value) => updateFilter("publisher", value)}
            options={filterOptions.publisher}
            value={filters.publisher}
          />
        </div>
      ) : null}

      {visibleGames.length === 0 ? (
        <EmptyState
          title={
            games.length === 0
              ? "Todavía no hay juegos en el catálogo."
              : "No hay juegos que coincidan con los filtros."
          }
          description={
            games.length === 0
              ? "Crea el primer juego para poder asociarlo a una semana."
              : "Prueba con otra búsqueda o limpia los filtros avanzados."
          }
        />
      ) : (
        <div className="rounded-lg border theme-border theme-surface">
          <div className="w-full text-left text-sm" role="table">
            <div
              className="text-xs font-semibold uppercase theme-table-head"
              role="rowgroup"
            >
                <div className={rowGridClass()} role="row">
                  <div
                    aria-sort={
                      sort.key === "title"
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={cellClass("whitespace-nowrap")}
                    role="columnheader"
                  >
                    <button
                      className="font-semibold uppercase theme-hover theme-text"
                      onClick={() => toggleSort("title")}
                      type="button"
                    >
                      Título{sortIndicator("title")}
                    </button>
                  </div>
                  <div
                    aria-sort={
                      sort.key === "year"
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={cellClass("hidden whitespace-nowrap md:block")}
                    role="columnheader"
                  >
                    <button
                      className="font-semibold uppercase theme-hover theme-text"
                      onClick={() => toggleSort("year")}
                      type="button"
                    >
                      Año{sortIndicator("year")}
                    </button>
                  </div>
                  <div
                    className={cellClass("hidden whitespace-nowrap md:block")}
                    role="columnheader"
                  >
                    Desarrollador
                  </div>
                  <div
                    className={cellClass("hidden whitespace-nowrap md:block")}
                    role="columnheader"
                  >
                    Editor
                  </div>
                  <div
                    className={cellClass("hidden whitespace-nowrap md:block")}
                    role="columnheader"
                  >
                    Género
                  </div>
                  <div
                    className={cellClass("whitespace-nowrap")}
                    role="columnheader"
                  >
                  </div>
                </div>
              </div>
              <div className="divide-y theme-border theme-surface" role="rowgroup">
                {visibleGames.map((game) => (
                  <div
                    className={`${rowGridClass()} theme-hover`}
                    key={game.id}
                    role="row"
                  >
                    <div className={cellClass("font-semibold theme-text")} role="cell">
                      <span
                        className="block max-w-[16rem] truncate md:max-w-[18rem]"
                        title={game.title}
                      >
                        {game.title}
                      </span>
                    </div>
                    <div
                      className={cellClass(
                        "hidden whitespace-nowrap theme-text-muted md:block",
                      )}
                      role="cell"
                    >
                      {game.year ?? "-"}
                    </div>
                    <div className={cellClass("hidden md:block")} role="cell">
                      {renderTagValue(game.developers)}
                    </div>
                    <div className={cellClass("hidden md:block")} role="cell">
                      {renderTagValue(game.publishers)}
                    </div>
                    <div className={cellClass("hidden md:block")} role="cell">
                      {renderTagValue([
                        ...game.genres,
                        ...game.themes,
                        ...game.perspectives,
                      ])}
                    </div>
                    <div className={cellClass("whitespace-nowrap")} role="cell">
                      <Link
                        className="font-semibold text-circuit hover:underline"
                        href={`/admin/games/${game.id}`}
                      >
                        Editar
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        </div>
      )}
    </div>
  );
}
