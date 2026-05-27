"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameRow } from "@/types/supabase";
import { DataTable, TableHead } from "./ui/table";
import { EmptyState } from "./ui/state";

type AdminGamesTableProps = {
  games: GameRow[];
};

function matchesSearch(game: GameRow, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return [
    game.title,
    game.rom_name,
    game.developer,
    game.publisher,
  ].some((value) => value?.toLowerCase().includes(query));
}

export function AdminGamesTable({ games }: AdminGamesTableProps) {
  const [search, setSearch] = useState("");
  const visibleGames = useMemo(
    () => games.filter((game) => matchesSearch(game, search)),
    [games, search],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="block w-full max-w-lg">
          <span className="text-sm font-semibold theme-text">Buscar juego</span>
          <input
            className="mt-2 w-full rounded-md border px-3 py-2 theme-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título, ROM, developer o publisher"
            value={search}
          />
        </label>
        <Link
          className="w-fit rounded-md bg-circuit px-4 py-3 text-sm font-semibold text-white"
          href="/admin/games/new"
        >
          Crear juego
        </Link>
      </div>
      {visibleGames.length === 0 ? (
        <EmptyState
          title="No hay juegos."
          description="Ajusta la búsqueda o crea un juego nuevo."
        />
      ) : (
        <DataTable>
          <TableHead
            labels={[
              "Título",
              "Año",
              "Developer",
              "Publisher",
              "ROM",
              "Género",
              "Control",
              "Dificultad",
              "Imagen",
              "",
            ]}
          />
          <tbody className="divide-y theme-border theme-surface">
            {visibleGames.map((game) => (
              <tr className="theme-hover" key={game.id}>
                <td className="whitespace-nowrap px-4 py-4 font-semibold theme-text">
                  {game.title}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.year ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.developer ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.publisher ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.rom_name ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.genre ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.control_type ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.difficulty ?? "-"}
                </td>
                <td className="whitespace-nowrap px-4 py-4 theme-text-muted">
                  {game.image_url ? "Sí" : "No"}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
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
