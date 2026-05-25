import type { WeekStatus } from "@/types";

const statusStyles: Record<WeekStatus, string> = {
  draft: "theme-border theme-surface theme-text-muted",
  active: "border-emerald-300 bg-emerald-100 text-emerald-900",
  frozen: "theme-border theme-surface theme-text-muted",
  closed: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-text)]",
  published: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-text)]",
};

const statusLabels: Record<WeekStatus, string> = {
  draft: "Inactiva",
  active: "Activa",
  frozen: "Inactiva",
  closed: "Cerrada",
  published: "Cerrada",
};

type StatusBadgeProps = {
  status: WeekStatus;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
