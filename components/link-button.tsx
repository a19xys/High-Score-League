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
      ? "bg-ink text-white hover:bg-slate-700"
      : "border border-slate-300 bg-white text-ink hover:bg-slate-50";

  return (
    <Link
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition ${classes}`}
      href={href}
    >
      {children}
    </Link>
  );
}
