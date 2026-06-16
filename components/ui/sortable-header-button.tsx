import type { ReactNode } from "react";

type SortDirection = "asc" | "desc";

type SortableHeaderButtonProps = {
  align?: "left" | "right";
  children: ReactNode;
  currentDirection: SortDirection;
  isActive: boolean;
  label: string;
  onClick: () => void;
};

function MaskIcon({
  className,
  src,
}: {
  className: string;
  src: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
      style={{
        WebkitMask: `url('${src}') center / contain no-repeat`,
        mask: `url('${src}') center / contain no-repeat`,
      }}
    />
  );
}

export function SortableHeaderButton({
  align = "left",
  children,
  currentDirection,
  isActive,
  label,
  onClick,
}: SortableHeaderButtonProps) {
  return (
    <button
      aria-label={label}
      aria-sort={isActive ? (currentDirection === "asc" ? "ascending" : "descending") : "none"}
      className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm font-semibold uppercase tracking-[0.02em] transition hover:text-circuit focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
        isActive ? "text-circuit" : "theme-text-muted"
      } ${align === "right" ? "justify-end text-right" : "justify-start text-left"}`}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      <span
        aria-hidden="true"
        className={`inline-flex h-4 w-4 items-center justify-center text-[11px] leading-none ${
          isActive ? "text-circuit" : "opacity-45"
        }`}
      >
        {isActive ? (
          currentDirection === "asc" ? (
            "▲"
          ) : (
            "▼"
          )
        ) : (
          <MaskIcon className="h-3.5 w-3.5 bg-current" src="/icons/sort-vertical.png" />
        )}
      </span>
    </button>
  );
}
