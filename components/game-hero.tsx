import type { Game } from "@/types";

type GameHeroProps = {
  game: Game;
};

export function GameHero({ game }: GameHeroProps) {
  const backgroundStyle = game.imageUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.86)), url(${game.imageUrl})`,
      }
    : undefined;

  return (
    <div
      aria-label={game.imageAlt}
      className={
        game.imageUrl
          ? "relative flex min-h-80 items-end overflow-hidden rounded-lg border bg-cover bg-center p-6 text-white shadow-panel theme-border"
          : "relative flex min-h-80 items-end overflow-hidden rounded-lg border bg-[linear-gradient(135deg,#111827_0%,#0f766e_52%,#ef4444_100%)] p-6 text-white shadow-panel theme-border"
      }
      role="img"
      style={backgroundStyle}
    >
      <div className="relative z-10">
        <p className="text-sm font-semibold uppercase text-slate-200">
          {game.imageUrl ? "Juego activo" : "Placeholder arcade"}
        </p>
        <h1 className="mt-2 text-4xl font-bold">{game.title}</h1>
        <p className="mt-2 text-slate-200">{game.genre}</p>
      </div>
    </div>
  );
}
