"use client";

import { useEffect, useState } from "react";

type ProfileAvatarProps = {
  avatarUrl?: string | null;
  initials: string;
  username?: string | null;
  size?: "chat" | "submission" | "pill" | "small" | "medium" | "large" | "hero";
  decorative?: boolean;
  className?: string;
};

const sizeClasses = {
  chat: "h-7 w-7 text-[10px]",
  submission: "h-7 w-7 text-[9px]",
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

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  const sharedClassName = `${sizeClasses[size]} relative shrink-0 overflow-hidden rounded-full theme-surface-strong ${className}`;

  return (
    <span
      aria-label={decorative ? undefined : `Avatar de @${username ?? initials}`}
      aria-hidden={decorative ? "true" : undefined}
      className={`${sharedClassName} inline-flex items-center justify-center font-bold`}
      role={decorative ? undefined : "img"}
    >
      {initials || "HSL"}
      {avatarUrl && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImageFailed(true)}
          src={avatarUrl}
        />
      ) : null}
    </span>
  );
}
