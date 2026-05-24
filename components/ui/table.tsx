import type { ReactNode } from "react";

type DataTableProps = {
  children: ReactNode;
};

export function DataTable({ children }: DataTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border theme-border theme-surface">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y text-left text-sm theme-border">
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
