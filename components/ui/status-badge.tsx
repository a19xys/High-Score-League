import type { WeekStatus } from "@/types";

const statusStyles: Record<WeekStatus, string> = {
  draft: "theme-border theme-surface theme-text-muted",
  active: "border-circuit/30 bg-circuit/10 text-teal-800",
  frozen: "border-cabinet/30 bg-cabinet/10 text-amber-800",
  closed: "theme-border theme-surface-muted theme-text-muted",
  published: "border-arcade/30 bg-arcade/10 text-red-800",
};

const statusLabels: Record<WeekStatus, string> = {
  draft: "Borrador",
  active: "Activa",
  frozen: "Congelada",
  closed: "Cerrada",
  published: "Publicada",
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
