"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card, CardHeader } from "@/components/ui/card";
import {
  ARCHIVE_PATHS,
  resolveArchiveSection,
  type ArchiveSection,
} from "@/lib/archive";

type ArchivePanel = {
  description: string;
  id: ArchiveSection;
  label: string;
  panel: ReactNode;
  warning?: string | null;
};

export function ArchiveSectionSwitcher({ panels }: { panels: ArchivePanel[] }) {
  const [activeSection, setActiveSection] = useState<ArchiveSection>("weeks");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    function syncFromHash() {
      const resolved = resolveArchiveSection(window.location.hash);
      setActiveSection(resolved);

      if (window.location.hash !== `#${resolved}`) {
        window.history.replaceState(null, "", ARCHIVE_PATHS[resolved]);
      }
    }

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  function selectSection(section: ArchiveSection) {
    setActiveSection(section);
    window.history.replaceState(null, "", ARCHIVE_PATHS[section]);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % panels.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + panels.length) % panels.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = panels.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    selectSection(panels[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  const activePanel =
    panels.find((panel) => panel.id === activeSection) ?? panels[0];

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: activePanel.label }]} />
      <Card>
        <CardHeader eyebrow="Historial de la liga" title="Archivo">
          Consulta semanas y temporadas anteriores desde un único lugar.
        </CardHeader>
        <div
          aria-label="Secciones del archivo"
          className="grid grid-cols-2 gap-1 rounded-lg border p-1 theme-border theme-surface-muted"
          role="tablist"
        >
          {panels.map((panel, index) => {
            const selected = panel.id === activeSection;

            return (
              <button
                aria-controls={`archive-panel-${panel.id}`}
                aria-selected={selected}
                className={`min-h-11 min-w-0 rounded-md px-3 py-2.5 text-center text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
                  selected
                    ? "bg-circuit text-white shadow-sm"
                    : "theme-text-muted theme-hover hover:text-circuit"
                }`}
                id={`archive-tab-${panel.id}`}
                key={panel.id}
                onClick={() => selectSection(panel.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {panel.label}
              </button>
            );
          })}
        </div>

        {panels.map((panel) => (
          <div
            aria-labelledby={`archive-tab-${panel.id}`}
            className="mt-6 space-y-4 border-t pt-6 theme-border"
            hidden={panel.id !== activeSection}
            id={`archive-panel-${panel.id}`}
            key={panel.id}
            role="tabpanel"
            tabIndex={0}
          >
            <div>
              <h2 className="text-xl font-bold theme-text">{panel.label}</h2>
              <p className="mt-1 text-sm leading-6 theme-text-muted">
                {panel.description}
              </p>
            </div>
            {panel.warning ? (
              <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-surface)] p-4 text-sm text-[var(--warning-text)]">
                {panel.warning}
              </div>
            ) : null}
            {panel.panel}
          </div>
        ))}
      </Card>
    </div>
  );
}
