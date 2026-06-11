"use client";

import { useState } from "react";

type GameHeroMediaProps = {
  src: string;
};

export function GameHeroMedia({ src }: GameHeroMediaProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <img
      alt=""
      className={`absolute inset-0 z-0 h-full w-full object-cover transition-opacity duration-500 ease-out ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
      decoding="async"
      onLoad={() => setLoaded(true)}
      src={src}
    />
  );
}
