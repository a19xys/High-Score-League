import Link, { type LinkProps } from "next/link";
import type { ReactNode } from "react";

type ActionLinkProps = LinkProps & {
  children: ReactNode;
  className?: string;
  icon?: "back";
  variant?: "primary" | "secondary";
};

const variants = {
  primary: "border-circuit bg-circuit text-white hover:brightness-110",
  secondary: "theme-border theme-surface theme-text theme-hover",
};

function cleanBackLabel(children: ReactNode) {
  if (typeof children !== "string") {
    return children;
  }

  return children.replace(/^(?:←|â†)\s*/, "");
}

export function ActionLink({
  children,
  className = "",
  icon,
  variant = "secondary",
  ...props
}: ActionLinkProps) {
  return (
    <Link
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${variants[variant]} ${className}`}
      {...props}
    >
      {icon === "back" ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 bg-current"
          style={{
            WebkitMask: "url('/icons/arrow-left.png') center / contain no-repeat",
            mask: "url('/icons/arrow-left.png') center / contain no-repeat",
          }}
        />
      ) : null}
      {icon === "back" ? cleanBackLabel(children) : children}
    </Link>
  );
}
