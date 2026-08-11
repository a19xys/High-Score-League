import type { ReactNode } from "react";

type DataTableProps = {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
};

export function DataTable({
  children,
  className = "",
  tableClassName = "",
}: DataTableProps) {
  return (
    <div className={`rounded-lg border theme-border theme-surface ${className}`}>
      <div className="overflow-x-auto overflow-y-visible">
        <table
          className={`min-w-full divide-y text-left text-sm theme-border ${tableClassName}`}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

type TableHeadProps = {
  labels: string[];
};

export function TableHead({ labels }: TableHeadProps) {
  return (
    <thead className="text-xs font-semibold uppercase theme-table-head">
      <tr>
        {labels.map((label) => (
          <th className="whitespace-nowrap px-4 py-3" key={label} scope="col">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
