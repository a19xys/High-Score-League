import type { CSSProperties } from "react";
import { GameLogo } from "@/components/game-logo";
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

function getSafeHexColor(value?: string | null) {
  return value && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : null;
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgba(hex: string, alpha: number) {
  const color = hexToRgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

export function GameHero({ game }: GameHeroProps) {
  const mediaUrl = game.headerImageUrl ?? game.imageUrl;
  const taxonomy = [...game.genres, ...game.themes, ...game.perspectives];
  const publisherText = game.publishers.join(" · ");
  const hasMetaLine = Boolean(publisherText || game.year);
  const accentPrimary = getSafeHexColor(game.accentColorPrimary) ?? "#00C9A7";
  const accentSecondary =
    getSafeHexColor(game.accentColorSecondary) ??
    getSafeHexColor(game.accentColorPrimary) ??
    "#22D3EE";
  const backgroundStyle = mediaUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(15, 23, 42, 0.86)), url(${mediaUrl})`,
      }
    : undefined;
  const frameStyle = {
    background: `linear-gradient(135deg, ${rgba(accentPrimary, 0.95)}, ${rgba(accentSecondary, 0.82)})`,
    boxShadow: `0 18px 44px ${rgba(accentPrimary, 0.16)}, 0 0 38px ${rgba(accentSecondary, 0.13)}`,
  } satisfies CSSProperties;

  return (
    <div className="h-full rounded-lg p-[1px]" style={frameStyle}>
      <div
        aria-label={game.imageAlt}
        className={
          mediaUrl
            ? "relative flex h-full min-h-[22rem] items-end overflow-hidden rounded-[calc(0.5rem-1px)] bg-cover bg-center p-6 text-white"
            : "relative flex h-full min-h-[22rem] items-end overflow-hidden rounded-[calc(0.5rem-1px)] bg-[linear-gradient(135deg,#111827_0%,#0f766e_52%,#ef4444_100%)] p-6 text-white"
        }
        role="img"
        style={backgroundStyle}
      >
        <div className="relative z-10 max-w-full">
          {game.logoImageUrl ? (
            <>
              <h1 className="sr-only">{game.title}</h1>
              <GameLogo src={game.logoImageUrl} />
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
    </div>
  );
}
