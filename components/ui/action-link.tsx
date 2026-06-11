import Link, { type LinkProps } from "next/link";
import type { ReactNode } from "react";

type ActionLinkProps = LinkProps & {
  children: ReactNode;
  className?: string;
  variant?: "primary" | "secondary";
};

const variants = {
  primary: "border-circuit bg-circuit text-white hover:brightness-110",
  secondary: "theme-border theme-surface theme-text theme-hover",
};

export function ActionLink({
  children,
  className = "",
  variant = "secondary",
  ...props
}: ActionLinkProps) {
  return (
    <Link
      className={`inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}
