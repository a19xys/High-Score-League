const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..", "..");

test("web applies Manrope and Sora through next/font and global font variables", async () => {
  const [layout, globals, tailwind] = await Promise.all([
    fsp.readFile(path.join(repoRoot, "app", "layout.tsx"), "utf8"),
    fsp.readFile(path.join(repoRoot, "app", "globals.css"), "utf8"),
    fsp.readFile(path.join(repoRoot, "tailwind.config.ts"), "utf8"),
  ]);

  assert.match(layout, /import \{ Manrope, Sora \} from "next\/font\/google"/);
  assert.match(layout, /const manrope = Manrope\(/);
  assert.match(layout, /const sora = Sora\(/);
  assert.match(layout, /variable: "--font-sans"/);
  assert.match(layout, /variable: "--font-title"/);
  assert.match(layout, /weight: \["400", "500", "600", "700", "800"\]/);
  assert.match(layout, /weight: \["400", "600", "700", "800"\]/);
  assert.match(layout, /<body className=\{`\$\{manrope\.variable\} \$\{sora\.variable\}`\}>/);
  assert.match(globals, /font-family: var\(--font-sans\), system-ui, sans-serif/);
  assert.match(globals, /font-family: var\(--font-title\), var\(--font-sans\), system-ui, sans-serif/);
  assert.match(globals, /--surface-elevated: #ffffff/);
  assert.match(globals, /--border-soft: #dce6f1/);
  assert.match(globals, /--surface-hover: #e4edf7/);
  assert.match(tailwind, /fontFamily/);
  assert.match(tailwind, /sans: \["var\(--font-sans\)", "system-ui", "sans-serif"\]/);
  assert.match(tailwind, /title: \["var\(--font-title\)", "var\(--font-sans\)", "system-ui", "sans-serif"\]/);
  assert.doesNotMatch(`${layout}\n${globals}`, /fonts\.googleapis\.com|@import\s+url\(/);
});

test("launcher uses local Manrope and Sora assets without remote font URLs", async () => {
  const launcherRoot = path.join(repoRoot, "local", "hsl-local-app", "gui", "renderer");
  const [indexHtml, tokens, styles] = await Promise.all([
    fsp.readFile(path.join(launcherRoot, "index.html"), "utf8"),
    fsp.readFile(path.join(launcherRoot, "styles", "tokens.css"), "utf8"),
    fsp.readFile(path.join(launcherRoot, "styles", "app.css"), "utf8"),
  ]);
  const fontDir = path.join(launcherRoot, "assets", "fonts", "manrope");
  const expectedFonts = [
    "Manrope-Regular.woff2",
    "Manrope-Medium.woff2",
    "Manrope-SemiBold.woff2",
    "Manrope-Bold.woff2",
    "Manrope-ExtraBold.woff2",
    "OFL-1.1.txt",
  ];
  const soraFontDir = path.join(launcherRoot, "assets", "fonts", "sora");
  const expectedTitleFonts = [
    "Sora-Regular.woff2",
    "Sora-SemiBold.woff2",
    "Sora-Bold.woff2",
    "Sora-ExtraBold.woff2",
    "OFL-1.1.txt",
  ];

  for (const filename of expectedFonts) {
    const stat = await fsp.stat(path.join(fontDir, filename));
    assert.equal(stat.isFile(), true);
  }

  for (const filename of expectedTitleFonts) {
    const stat = await fsp.stat(path.join(soraFontDir, filename));
    assert.equal(stat.isFile(), true);
  }

  assert.match(tokens, /--font-sans: "Manrope", ui-sans-serif, system-ui/);
  assert.match(tokens, /--font-title: "Sora", var\(--font-sans\)/);
  assert.match(tokens, /--surface-elevated: #ffffff/);
  assert.match(tokens, /--surface-subtle: #f3f7fc/);
  assert.match(tokens, /--border-soft: #dce6f1/);
  assert.match(tokens, /--icon-stage: #d7e5f2/);
  assert.match(tokens, /--circuit-soft: #d9eef8/);
  assert.match(styles, /@font-face[\s\S]*font-family: "Manrope"[\s\S]*Manrope-Regular\.woff2/);
  assert.match(styles, /@font-face[\s\S]*font-family: "Sora"[\s\S]*Sora-Regular\.woff2/);
  assert.match(styles, /font-family: var\(--font-sans\)/);
  assert.match(styles, /font-family: var\(--font-title\)/);
  assert.match(styles, /font-weight: 400/);
  assert.match(styles, /HSL-MANROPE-TYPOGRAPHY-1/);
  assert.match(styles, /WEB-LOCAL-LIGHT-THEME-SORA-PASS-1/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.pack-card__media/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.library-control-button/);
  assert.match(styles, /html:not\(\[data-theme="dark"\]\) \.badge-ok/);
  assert.doesNotMatch(`${indexHtml}\n${tokens}\n${styles}`, /fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\/[^"')\s]+/);
  assert.doesNotMatch(styles, /font-family: Inter/);
});
