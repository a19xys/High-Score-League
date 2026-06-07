import type { Game } from "@/types";

type GameHeroProps = {
  game: Game;
};

function MaskIcon({
  className,
  src,
}: {
  className: string;
  src: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{
        WebkitMask: `url('${src}') center / contain no-repeat`,
        mask: `url('${src}') center / contain no-repeat`,
      }}
    />
  );
}

export function GameHero({ game }: GameHeroProps) {
  const mediaUrl = game.headerImageUrl ?? game.imageUrl;
  const taxonomy = [...game.genres, ...game.themes, ...game.perspectives];
  const publisherText = game.publishers.join(" · ");
  const hasMetaLine = Boolean(publisherText || game.year);
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
          ? "relative flex min-h-80 items-end overflow-hidden rounded-lg border border-circuit/30 bg-cover bg-center p-6 text-white shadow-[0_18px_40px_rgba(0,201,167,0.14)]"
          : "relative flex min-h-80 items-end overflow-hidden rounded-lg border border-circuit/30 bg-[linear-gradient(135deg,#111827_0%,#0f766e_52%,#ef4444_100%)] p-6 text-white shadow-[0_18px_40px_rgba(0,201,167,0.14)]"
      }
      role="img"
      style={backgroundStyle}
    >
      <div className="relative z-10 max-w-full">
        {game.logoImageUrl ? (
          <>
            <h1 className="sr-only">{game.title}</h1>
            <img
              alt=""
              className="max-h-24 max-w-[min(24rem,100%)] object-contain object-left drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
              src={game.logoImageUrl}
            />
          </>
        ) : (
          <h1 className="max-w-full truncate text-4xl font-bold">{game.title}</h1>
        )}
        {taxonomy.length > 0 ? (
          <p
            className="mt-3 max-w-full truncate text-sm font-semibold text-slate-100"
            title={taxonomy.join(" · ")}
          >
            {taxonomy.join(" · ")}
          </p>
        ) : null}
        {hasMetaLine ? (
          <div className="mt-2 flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-200">
            {publisherText ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MaskIcon className="h-3.5 w-3.5 bg-current" src="/icons/publisher.png" />
                <span className="truncate" title={publisherText}>
                  {publisherText}
                </span>
              </span>
            ) : null}
            {game.year ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <MaskIcon className="h-3.5 w-3.5 bg-current" src="/icons/calendar.png" />
                {game.year}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
