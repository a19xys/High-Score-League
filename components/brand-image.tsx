"use client";

import { type ReactNode, useEffect, useState } from "react";

export function BrandImage({
  alt,
  className,
  fallback,
  src,
}: {
  alt: string;
  className: string;
  fallback: ReactNode;
  src: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  if (imageFailed) {
    return fallback;
  }

  return (
    <img
      alt={alt}
      className={className}
      onError={() => setImageFailed(true)}
      src={src}
    />
  );
}
