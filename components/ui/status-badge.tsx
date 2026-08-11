import type { SeasonStatus, WeekStatus } from "@/types";

type StatusValue = WeekStatus | SeasonStatus;

const statusStyles: Record<StatusValue, string> = {
  draft: "theme-border theme-surface theme-text-muted",
  active: "border-emerald-300 bg-emerald-100 text-emerald-900",
  frozen: "theme-border theme-surface theme-text-muted",
  closed: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-text)]",
  published: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-text)]",
  completed: "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-text)]",
};

const statusLabels: Record<StatusValue, string> = {
  draft: "Inactiva",
  active: "Activa",
  frozen: "Activa",
  closed: "Cerrada",
  published: "Cerrada",
  completed: "Cerrada",
};

type StatusBadgeProps = {
  compact?: boolean;
  status: StatusValue;
};

export function StatusBadge({ compact = false, status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border text-xs font-semibold uppercase ${
        compact ? "px-2 py-0.5 text-[10px] leading-4" : "px-3 py-1"
      } ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
