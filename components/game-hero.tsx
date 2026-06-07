import type { Game } from "@/types";

type GameHeroProps = {
  game: Game;
};

export function GameHero({ game }: GameHeroProps) {
  const mediaUrl = game.headerImageUrl ?? game.imageUrl;
  const backgroundStyle = mediaUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.86)), url(${mediaUrl})`,
      }
    : undefined;

  return (
    <div
      aria-label={game.imageAlt}
      className={
        mediaUrl
          ? "relative flex min-h-80 items-end overflow-hidden rounded-lg border bg-cover bg-center p-6 text-white shadow-panel theme-border"
          : "relative flex min-h-80 items-end overflow-hidden rounded-lg border bg-[linear-gradient(135deg,#111827_0%,#0f766e_52%,#ef4444_100%)] p-6 text-white shadow-panel theme-border"
      }
      role="img"
      style={backgroundStyle}
    >
      <div className="relative z-10 max-w-full">
        <p className="text-sm font-semibold uppercase text-slate-200">
          {mediaUrl ? "Juego activo" : "Placeholder arcade"}
        </p>
        {game.logoImageUrl ? (
          <>
            <h1 className="sr-only">{game.title}</h1>
            <img
              alt=""
              className="mt-3 max-h-24 max-w-[min(24rem,100%)] object-contain object-left drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
              src={game.logoImageUrl}
            />
          </>
        ) : (
          <h1 className="mt-2 text-4xl font-bold">{game.title}</h1>
        )}
        <p className="mt-2 text-slate-200">{game.genre}</p>
      </div>
    </div>
  );
}
