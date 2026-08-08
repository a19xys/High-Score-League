import type { Metadata } from "next";
import Link from "next/link";
import { permanentRedirect } from "next/navigation";
import { AccessRequired } from "@/components/auth/access-required";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card } from "@/components/ui/card";
import { hasServerSession } from "@/lib/auth/session";
import { getArchivePath } from "@/lib/archive";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Archivo | High Score League",
};

type ArchivePageProps = {
  searchParams: Promise<{
    section?: string | string[];
  }>;
};

const archiveSections = [
  {
    description: "Explora las jornadas publicadas y sus resultados históricos.",
    href: "/archive/weeks",
    label: "Semanas",
  },
  {
    description: "Consulta las temporadas visibles y su recorrido competitivo.",
    href: "/archive/seasons",
    label: "Temporadas",
  },
] as const;

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const { section } = await searchParams;

  if (section !== undefined) {
    permanentRedirect(getArchivePath(section));
  }

  if (!(await hasServerSession())) {
    return <AccessRequired />;
  }

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Archivo" }]} />
      <Card>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase theme-text-muted">
            Historial de la liga
          </p>
          <h1 className="mt-1 text-2xl font-bold theme-text">Archivo</h1>
          <p className="mt-2 text-sm leading-6 theme-text-muted">
            Recorre el historial competitivo de High Score League por semanas o
            por temporadas.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {archiveSections.map((sectionCard) => (
            <Link
              className="group flex min-h-40 flex-col justify-between rounded-lg border p-5 transition theme-border theme-surface-muted theme-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit"
              href={sectionCard.href}
              key={sectionCard.href}
            >
              <div>
                <h2 className="text-xl font-bold theme-text transition group-hover:text-circuit">
                  {sectionCard.label}
                </h2>
                <p className="mt-2 text-sm leading-6 theme-text-muted">
                  {sectionCard.description}
                </p>
              </div>
              <span className="mt-5 text-sm font-bold text-circuit">
                Abrir {sectionCard.label.toLowerCase()} <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
