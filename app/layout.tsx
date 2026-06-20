import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "High Score League",
  description: "Liga privada de puntuaciones arcade entre amigos.",
};

const themeScript = `
(() => {
  const storageKey = "hsl-theme";
  const maxAge = 31536000;
  const validPreferences = new Set(["light", "dark", "system"]);

  const readCookiePreference = () => {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(storageKey + "="));
    const value = match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
    return validPreferences.has(value) ? value : null;
  };

  const readLocalPreference = () => {
    try {
      const value = localStorage.getItem(storageKey);
      return validPreferences.has(value) ? value : null;
    } catch {
      return null;
    }
  };

  const writeCookiePreference = (preference) => {
    document.cookie = storageKey + "=" + encodeURIComponent(preference) + "; Path=/; Max-Age=" + maxAge + "; SameSite=Lax";
  };

  const applyTheme = (preference) => {
    document.documentElement.dataset.themePreference = preference;

    if (preference === "light" || preference === "dark") {
      document.documentElement.dataset.theme = preference;
      document.documentElement.style.colorScheme = preference;
      return;
    }

    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  try {
    const cookiePreference = readCookiePreference();
    const localPreference = readLocalPreference();
    const preference = cookiePreference || localPreference || "system";

    if (!cookiePreference) {
      writeCookiePreference(preference);
    }

    try {
      if (localPreference !== preference) {
        localStorage.setItem(storageKey, preference);
      }
    } catch {}

    applyTheme(preference);
  } catch {
    delete document.documentElement.dataset.theme;
    document.documentElement.dataset.themePreference = "system";
  }
})();
`;

type ThemePreference = "light" | "dark" | "system";

function normalizeThemePreference(value?: string): ThemePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themePreference = normalizeThemePreference(
    cookieStore.get("hsl-theme")?.value,
  );
  const themeAttributes =
    themePreference === "system"
      ? { "data-theme-preference": "system" }
      : {
          "data-theme": themePreference,
          "data-theme-preference": themePreference,
        };

  return (
    <html lang="es" suppressHydrationWarning {...themeAttributes}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <SiteNav />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
