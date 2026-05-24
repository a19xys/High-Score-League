import type { ReactNode } from "react";

type StateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: StateProps) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center theme-border theme-surface-muted">
      <p className="font-semibold theme-text">{title}</p>
      {description ? (
        <p className="mx-auto mt-2 max-w-xl text-sm theme-text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ title = "Cargando datos..." }: Partial<StateProps>) {
  return (
    <div className="rounded-lg border p-6 theme-border theme-surface">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 rounded-full bg-circuit" />
        <p className="text-sm font-semibold theme-text">{title}</p>
      </div>
    </div>
  );
}

export function ErrorState({
  title = "No se pudieron cargar los datos.",
  description,
  action,
}: Partial<StateProps>) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-900">
      <p className="font-semibold">{title}</p>
      {description ? <p className="mt-2 text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PlaceholderSection({ title, description, action }: StateProps) {
  return (
    <div className="rounded-lg border p-5 theme-border theme-surface-muted">
      <p className="font-semibold theme-text">{title}</p>
      {description ? <p className="mt-2 text-sm theme-text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
