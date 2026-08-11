"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  resolveProfileSection,
  type ProfileSectionId,
} from "@/lib/profile-sections";

export type ProfileSection = {
  id: ProfileSectionId;
  label: string;
  panel: ReactNode;
};

export function ProfileSectionSwitcher({
  sections,
}: {
  sections: ProfileSection[];
}) {
  const availableSections = sections.map((section) => section.id);
  const [activeSection, setActiveSection] = useState<ProfileSectionId>("resumen");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const resolved = resolveProfileSection(window.location.hash, availableSections);
    setActiveSection(resolved);
    // Section availability is fixed for this server-rendered view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSection(sectionId: ProfileSectionId) {
    setActiveSection(sectionId);
    const nextUrl = `${window.location.pathname}${window.location.search}#${sectionId}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % sections.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + sections.length) % sections.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = sections.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextSection = sections[nextIndex];
    selectSection(nextSection.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="space-y-5">
      <div
        aria-label="Secciones del perfil"
        className={`mx-auto grid w-full max-w-4xl grid-cols-2 gap-2 rounded-2xl border p-2 shadow-panel theme-border theme-surface sm:grid-cols-4 ${
          sections.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"
        }`}
        role="tablist"
      >
        {sections.map((section, index) => {
          const selected = section.id === activeSection;
          const spansMobileRow = sections.length === 5 && index === 4;

          return (
            <button
              aria-controls={`profile-panel-${section.id}`}
              aria-selected={selected}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-center text-sm font-extrabold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-circuit ${
                spansMobileRow ? "col-span-2 sm:col-span-4 lg:col-span-1" : ""
              } ${
                selected
                  ? "bg-circuit text-slate-950 shadow-sm"
                  : "theme-text-muted hover:bg-[var(--hover)] hover:text-circuit"
              }`}
              id={`profile-tab-${section.id}`}
              key={section.id}
              onClick={() => selectSection(section.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {section.label}
            </button>
          );
        })}
      </div>

      {sections.map((section) => (
        <div
          aria-labelledby={`profile-tab-${section.id}`}
          hidden={section.id !== activeSection}
          id={`profile-panel-${section.id}`}
          key={section.id}
          role="tabpanel"
          tabIndex={0}
        >
          {section.panel}
        </div>
      ))}
    </div>
  );
}
