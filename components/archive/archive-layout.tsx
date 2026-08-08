import type { ReactNode } from "react";
import { ArchiveNavigation } from "@/components/archive/archive-navigation";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardHeader } from "@/components/ui/card";
import type { ArchiveSection } from "@/lib/archive";

export function ArchiveLayout({
  activeSection,
  children,
  description,
  title,
  warning,
}: {
  activeSection: ArchiveSection;
  children: ReactNode;
  description: string;
  title: string;
  warning?: string | null;
}) {
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { href: "/archive", label: "Archivo" },
          { label: title },
        ]}
      />
      <Card>
        <CardHeader eyebrow="Historial de la liga" title="Archivo">
          Consulta semanas y temporadas anteriores desde un único lugar.
        </CardHeader>
        <ArchiveNavigation activeSection={activeSection} />
        <div className="mt-6 space-y-4 border-t pt-6 theme-border">
          <div>
            <h2 className="text-xl font-bold theme-text">{title}</h2>
            <p className="mt-1 text-sm leading-6 theme-text-muted">
              {description}
            </p>
          </div>
          {warning ? (
            <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
              {warning}
            </div>
          ) : null}
          {children}
        </div>
      </Card>
    </div>
  );
}
