import type { ReactNode } from "react";

type DataTableProps = {
  children: ReactNode;
};

export function DataTable({ children }: DataTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
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
    <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
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
