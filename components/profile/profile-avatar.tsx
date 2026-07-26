"use client";

import { useEffect, useState } from "react";

type ProfileAvatarProps = {
  avatarUrl?: string | null;
  initials: string;
  username?: string | null;
  size?: "pill" | "small" | "medium" | "large" | "hero";
  decorative?: boolean;
  className?: string;
};

const sizeClasses = {
  pill: "h-8 w-8 text-[10px] sm:h-9 sm:w-9 sm:text-xs",
  small: "h-10 w-10 text-xs",
  medium: "h-14 w-14 text-base",
  large: "h-24 w-24 text-2xl",
  hero: "h-28 w-28 text-3xl sm:h-36 sm:w-36 sm:text-4xl",
};

export function ProfileAvatar({
  avatarUrl,
  initials,
  username,
  size = "large",
  decorative = false,
  className = "",
}: ProfileAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setImageLoaded(false);
  }, [avatarUrl]);

  const sharedClassName = `${sizeClasses[size]} relative shrink-0 overflow-hidden rounded-full border-2 border-white/25 bg-[linear-gradient(145deg,#0f766e,#0ea5e9_48%,#a855f7)] shadow-[0_16px_38px_rgba(2,6,23,0.28)] ${className}`;

  return (
    <span
      aria-label={decorative ? undefined : `Avatar de @${username ?? initials}`}
      aria-hidden={decorative ? "true" : undefined}
      className={`${sharedClassName} inline-flex items-center justify-center font-black tracking-[0.08em] text-white`}
      role={decorative ? undefined : "img"}
    >
      {initials || "HSL"}
      {avatarUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 motion-reduce:transition-none ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
          onError={() => setImageFailed(true)}
          onLoad={() => setImageLoaded(true)}
          src={avatarUrl}
        />
      ) : null}
    </span>
  );
}
