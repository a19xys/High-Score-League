(() => {
  const allowedThemes = new Set(["light", "dark"]);
  const bootstrap = window.hslLauncher?.startupTheme || {};
  let legacyTheme = null;

  if (bootstrap.legacyThemeMigrationAllowed === true) {
    try {
      const stored = localStorage.getItem("hsl-launcher-theme");
      legacyTheme = allowedThemes.has(stored) ? stored : null;
    } catch {}
  }

  let resolved = null;
  try {
    resolved = window.hslLauncher?.resolveThemeBootstrap?.(legacyTheme);
  } catch {}
  const mainTheme = allowedThemes.has(resolved?.effectiveTheme)
    ? resolved.effectiveTheme
    : allowedThemes.has(bootstrap.effectiveTheme) ? bootstrap.effectiveTheme : "dark";
  const initialTheme = mainTheme;
  document.documentElement.dataset.theme = initialTheme;
  document.documentElement.style.colorScheme = initialTheme;
  document.documentElement.classList.add("theme-bootstrap");
  window.__HSL_INITIAL_THEME__ = initialTheme;
  window.__HSL_THEME_BOOTSTRAP__ = Object.freeze({
    effectiveTheme: initialTheme,
    mode: resolved?.mode === "manual" ? "manual" : "system",
  });
  if (!legacyTheme || resolved?.legacyMigrationStatus !== "failed") {
    try { localStorage.removeItem("hsl-launcher-theme"); } catch {}
  }
})();
