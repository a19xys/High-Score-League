"use client";

import { BrandImage } from "@/components/brand-image";

export function BrandMark({ src = "/brand/logo.png" }: { src?: string }) {
  return (
    <BrandImage
      alt=""
      className="h-10 w-10 shrink-0 object-contain"
      fallback={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold theme-surface-strong">
          HSL
        </span>
      }
      src={src}
    />
  );
}
