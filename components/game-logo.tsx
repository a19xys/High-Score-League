"use client";

import { useState, type SyntheticEvent } from "react";

type LogoShape = "wide" | "tall" | "balanced";

type GameLogoProps = {
  src: string;
};

const logoShapeClasses: Record<LogoShape, string> = {
  wide: "max-h-28 max-w-[min(30rem,100%)] sm:max-h-32",
  tall: "max-h-52 max-w-[min(18rem,100%)] sm:max-h-60",
  balanced: "max-h-40 max-w-[min(24rem,100%)] sm:max-h-48",
};

function getLogoShape(width: number, height: number): LogoShape {
  if (width <= 0 || height <= 0) {
    return "balanced";
  }

  const ratio = width / height;

  if (ratio >= 2.4) {
    return "wide";
  }

  if (ratio <= 0.75) {
    return "tall";
  }

  return "balanced";
}

export function GameLogo({ src }: GameLogoProps) {
  const [shape, setShape] = useState<LogoShape>("balanced");

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    setShape(getLogoShape(image.naturalWidth, image.naturalHeight));
  }

  return (
    <img
      alt=""
      className={`${logoShapeClasses[shape]} w-auto object-contain object-left drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]`}
      onLoad={handleLoad}
      src={src}
    />
  );
}
