import Link from "next/link";
import type { ArchiveSection } from "@/lib/archive";

const sections: Array<{
  href: string;
  id: ArchiveSection;
  label: string;
}> = [
  { href: "/archive/weeks", id: "weeks", label: "Semanas" },
  {
    href: "/archive/seasons",
    id: "seasons",
    label: "Temporadas",
  },
];

export function ArchiveNavigation({
  activeSection,
}: {
  activeSection: ArchiveSection;
}) {
  return (
    <nav
      aria-label="Secciones del archivo"
      className="grid grid-cols-2 gap-1 rounded-lg border p-1 theme-border theme-surface-muted"
    >
      {sections.map((section) => {
        const isActive = section.id === activeSection;

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`min-w-0 rounded-md px-3 py-2.5 text-center text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
              isActive
                ? "bg-circuit text-white shadow-sm"
                : "theme-text-muted theme-hover hover:text-circuit"
            }`}
            href={section.href}
            key={section.id}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
