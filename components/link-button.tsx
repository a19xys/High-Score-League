import Link from "next/link";
import type { ReactNode } from "react";

type LinkButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
};

export function LinkButton({
  href,
  children,
  variant = "secondary",
}: LinkButtonProps) {
  const classes =
    variant === "primary"
      ? "bg-circuit text-ink shadow-panel hover:bg-circuit/90"
      : "border theme-border theme-surface theme-text theme-hover";

  return (
    <Link
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition ${classes}`}
      href={href}
    >
      {children}
    </Link>
  );
}
