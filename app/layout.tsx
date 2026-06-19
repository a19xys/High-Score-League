import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "High Score League",
  description: "Liga privada de puntuaciones arcade entre amigos.",
};

const themeScript = `
(() => {
  const applyTheme = (preference) => {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = resolvedTheme;
  };

  try {
    const storageKey = "hsl-theme";
    const preference = localStorage.getItem(storageKey) || "system";
    applyTheme(preference === "light" || preference === "dark" || preference === "system" ? preference : "system");
  } catch {
    try {
      applyTheme("system");
    } catch {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.themePreference = "system";
      document.documentElement.style.colorScheme = "dark";
    }
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
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
