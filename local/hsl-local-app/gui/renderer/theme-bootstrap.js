(() => {
  const allowedThemes = new Set(["light", "dark"]);
  let storedTheme = null;

  try {
    storedTheme = localStorage.getItem("hsl-launcher-theme");
  } catch {}

  const initialTheme = allowedThemes.has(storedTheme) ? storedTheme : "dark";
  document.documentElement.dataset.theme = initialTheme;
  document.documentElement.style.colorScheme = initialTheme;
  document.documentElement.classList.add("theme-bootstrap");
  window.__HSL_INITIAL_THEME__ = initialTheme;
})();
