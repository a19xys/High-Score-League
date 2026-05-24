import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white p-5 shadow-panel ${className}`}
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
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {children ? <div className="mt-2 text-sm text-slate-600">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
