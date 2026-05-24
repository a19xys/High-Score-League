"use client";

import { useEffect, useState } from "react";

type ThemePreference = "light" | "dark" | "system";

const storageKey = "hsl-theme";

function resolveTheme(preference: ThemePreference) {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  return preference;
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
}

export function ThemeSelect() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const storedPreference =
      (localStorage.getItem(storageKey) as ThemePreference | null) ?? "system";

    setPreference(storedPreference);
    applyTheme(storedPreference);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if ((localStorage.getItem(storageKey) ?? "system") === "system") {
        applyTheme("system");
      }
    };

    media.addEventListener("change", handleSystemChange);

    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  function handleChange(nextPreference: ThemePreference) {
    setPreference(nextPreference);
    localStorage.setItem(storageKey, nextPreference);
    applyTheme(nextPreference);
  }

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {[
        { value: "light", label: "Claro" },
        { value: "dark", label: "Oscuro" },
        { value: "system", label: "Sistema" },
      ].map((option) => (
        <button
          className={`rounded-md border px-4 py-3 text-sm font-semibold transition theme-border ${
            preference === option.value
              ? "theme-surface-strong"
              : "theme-surface theme-hover"
          }`}
          key={option.value}
          onClick={() => handleChange(option.value as ThemePreference)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
