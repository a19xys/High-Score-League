"use client";

import { useLayoutEffect, useState } from "react";

type ThemePreference = "light" | "dark" | "system";

const storageKey = "hsl-theme";
const maxAge = 31536000;
const validPreferences: ThemePreference[] = ["light", "dark", "system"];

function isThemePreference(value: string | null): value is ThemePreference {
  return validPreferences.includes(value as ThemePreference);
}

function readCookiePreference(): ThemePreference | null {
  let value: string | null = null;

  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${storageKey}=`));

    value = match
      ? decodeURIComponent(match.split("=").slice(1).join("="))
      : null;
  } catch {
    value = null;
  }

  return isThemePreference(value) ? value : null;
}

function writeCookiePreference(preference: ThemePreference) {
  try {
    document.cookie = `${storageKey}=${encodeURIComponent(
      preference,
    )}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch {}
}

function resolveTheme(preference: ThemePreference) {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  return preference;
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.themePreference = preference;

  if (preference === "light" || preference === "dark") {
    document.documentElement.dataset.theme = preference;
    document.documentElement.style.colorScheme = preference;
    return;
  }

  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = resolveTheme(preference);
}

function readStoredPreference(): ThemePreference {
  const cookiePreference = readCookiePreference();

  if (cookiePreference) {
    return cookiePreference;
  }

  let value: string | null = null;

  try {
    value = localStorage.getItem(storageKey);
  } catch {
    value = null;
  }

  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function ThemeSelect() {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useLayoutEffect(() => {
    const storedPreference = readStoredPreference();

    setPreference(storedPreference);
    writeCookiePreference(storedPreference);
    try {
      localStorage.setItem(storageKey, storedPreference);
    } catch {}
    applyTheme(storedPreference);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (readStoredPreference() === "system") {
        applyTheme("system");
      }
    };

    media.addEventListener("change", handleSystemChange);

    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  function handleChange(nextPreference: ThemePreference) {
    setPreference(nextPreference);
    writeCookiePreference(nextPreference);
    try {
      localStorage.setItem(storageKey, nextPreference);
    } catch {}
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
          aria-pressed={preference === option.value}
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
