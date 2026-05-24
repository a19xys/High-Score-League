import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <section
      className={`rounded-lg border p-5 shadow-panel theme-border theme-surface ${className}`}
    >
      {children}
    </section>
  );
}

type CardHeaderProps = {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  children?: ReactNode;
};

export function CardHeader({
  eyebrow,
  title,
  action,
  children,
}: CardHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase theme-text-muted">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-xl font-semibold theme-text">{title}</h2>
        {children ? <div className="mt-2 text-sm theme-text-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
