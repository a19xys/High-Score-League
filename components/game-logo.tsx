"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";

type LogoShape = "wide" | "tall" | "balanced";

type GameLogoProps = {
  src: string;
};

const logoShapeClasses: Record<LogoShape, string> = {
  wide: "max-h-24 max-w-[min(22rem,78%)] sm:max-h-28",
  tall: "max-h-52 max-w-[min(14rem,58%)] sm:max-h-60",
  balanced: "max-h-36 max-w-[min(20rem,76%)] sm:max-h-44",
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
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    const image = imageRef.current;

    if (image?.complete && image.naturalWidth > 0) {
      setShape(getLogoShape(image.naturalWidth, image.naturalHeight));
      setLoaded(true);
      return;
    }

    setLoaded(false);
  }, [src]);

  function handleLoad(event: SyntheticEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    setShape(getLogoShape(image.naturalWidth, image.naturalHeight));
    setLoaded(true);
  }

  if (failed) {
    return null;
  }

  return (
    <img
      alt=""
      className={`${logoShapeClasses[shape]} w-auto object-contain object-left drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)] transition duration-700 ease-out ${
        loaded ? "scale-100 opacity-100" : "scale-90 opacity-0"
      }`}
      onLoad={handleLoad}
      onError={() => setFailed(true)}
      ref={imageRef}
      src={src}
    />
  );
}
