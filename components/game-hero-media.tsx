"use client";

import { useEffect, useRef, useState } from "react";

type GameHeroMediaProps = {
  src: string;
};

export function GameHeroMedia({ src }: GameHeroMediaProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailed(false);
    const image = imageRef.current;

    if (image?.complete && image.naturalWidth > 0) {
      setLoaded(true);
      return;
    }

    setLoaded(false);
  }, [src]);

  if (failed) {
    return null;
  }

  return (
    <img
      alt=""
      className={`absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-1000 ease-out ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      ref={imageRef}
      src={src}
    />
  );
}
