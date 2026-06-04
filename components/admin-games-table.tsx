"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameRow } from "@/types/supabase";
import { DataTable } from "./ui/table";
import { EmptyState } from "./ui/state";

type AdminGamesTableProps = {
  games: GameRow[];
};

type FilterKey = "year" | "developer" | "publisher" | "genre";

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
    return value
      .map((item) => normalizeText(item).trim())
      .filter(Boolean);
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
            : [...game.perspectives, ...game.themes, ...game.genres];

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
          : [...game.perspectives, ...game.themes, ...game.genres];
  return getFilterValues(value).some((option) => option === selected);
}

function hasActiveFilters(filters: Filters) {
  return Object.values(filters).some(Boolean);
}

function renderListValue(value: string | string[] | number | null | undefined) {
  const values = getFilterValues(value);

  if (values.length === 0) {
    return <span className="theme-text-muted">-</span>;
  }

  if (values.length === 1) {
    return (
      <span className="block max-w-[14rem] truncate theme-text-muted" title={values[0]}>
        {values[0]}
      </span>
    );
  }

  const visibleValues = values.slice(0, 2);
  const hiddenCount = values.length - visibleValues.length;

  return (
    <span className="flex max-w-[16rem] flex-wrap gap-1">
      {visibleValues.map((item) => (
        <span
          className="max-w-[8rem] truncate rounded-full border px-2 py-0.5 text-xs theme-border theme-surface-muted theme-text-muted"
          key={item}
          title={item}
        >
          {item}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span className="rounded-full border px-2 py-0.5 text-xs theme-border theme-text-muted">
          +{hiddenCount}
        </span>
      ) : null}
    </span>
  );
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
      games.filter(
        (game) =>
          matchesSearch(game, search) &&
          matchesFilter(game, "year", filters.year) &&
          matchesFilter(game, "developer", filters.developer) &&
          matchesFilter(game, "publisher", filters.publisher) &&
          matchesFilter(game, "genre", filters.genre),
      ),
    [filters, games, search],
  );

  function updateFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
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
            className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-hover theme-text"
            onClick={() => setShowAdvancedFilters((current) => !current)}
            type="button"
          >
            Más filtros
          </button>
          {hasActiveFilters(filters) ? (
            <button
              className="rounded-md border px-4 py-3 text-sm font-semibold theme-border theme-hover theme-text-muted"
              onClick={() => setFilters(emptyFilters)}
              type="button"
            >
              Limpiar filtros
            </button>
          ) : null}
          <Link
            className="rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white"
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
          <FilterSelect
            label="Género"
            onChange={(value) => updateFilter("genre", value)}
            options={filterOptions.genre}
            value={filters.genre}
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
        <DataTable>
          <thead className="text-xs font-semibold uppercase theme-table-head">
            <tr>
              <th className="whitespace-nowrap px-4 py-3" scope="col">
                Título
              </th>
              <th className="whitespace-nowrap px-4 py-3" scope="col">
                Año
              </th>
              <th className="hidden whitespace-nowrap px-4 py-3 md:table-cell" scope="col">
                Desarrollador
              </th>
              <th className="whitespace-nowrap px-4 py-3" scope="col">
                Editor
              </th>
              <th className="hidden whitespace-nowrap px-4 py-3 md:table-cell" scope="col">
                Género
              </th>
              <th className="hidden whitespace-nowrap px-4 py-3 md:table-cell" scope="col">
                ROM
              </th>
              <th className="hidden whitespace-nowrap px-4 py-3 md:table-cell" scope="col">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="divide-y theme-border theme-surface">
            {visibleGames.map((game) => (
              <tr className="theme-hover" key={game.id}>
                <td className="px-4 py-4 font-semibold theme-text">
                  <Link
                    className="block max-w-[14rem] truncate text-circuit hover:underline sm:max-w-xs"
                    href={`/admin/games/${game.id}`}
                    title={game.title}
                  >
                    {game.title}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.year ?? "-"}
                </td>
                <td className="hidden px-4 py-4 md:table-cell">
                  {renderListValue(game.developers)}
                </td>
                <td className="px-4 py-4">{renderListValue(game.publishers)}</td>
                <td className="hidden px-4 py-4 md:table-cell">
                  {renderListValue([
                    ...game.perspectives,
                    ...game.themes,
                    ...game.genres,
                  ])}
                </td>
                <td className="hidden px-4 py-4 md:table-cell">
                  {renderListValue(game.rom_name)}
                </td>
                <td className="hidden whitespace-nowrap px-4 py-4 md:table-cell">
                  <Link
                    className="font-semibold text-circuit hover:underline"
                    href={`/admin/games/${game.id}`}
                  >
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
