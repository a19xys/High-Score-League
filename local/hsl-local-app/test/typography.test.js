const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..", "..");

test("web applies Manrope through next/font and global font variable", async () => {
  const [layout, globals, tailwind] = await Promise.all([
    fsp.readFile(path.join(repoRoot, "app", "layout.tsx"), "utf8"),
    fsp.readFile(path.join(repoRoot, "app", "globals.css"), "utf8"),
    fsp.readFile(path.join(repoRoot, "tailwind.config.ts"), "utf8"),
  ]);

  assert.match(layout, /import \{ Manrope \} from "next\/font\/google"/);
  assert.match(layout, /const manrope = Manrope\(/);
  assert.match(layout, /variable: "--font-sans"/);
  assert.match(layout, /weight: \["400", "500", "600", "700", "800"\]/);
  assert.match(layout, /<body className=\{manrope\.variable\}>/);
  assert.match(globals, /font-family: var\(--font-sans\), system-ui, sans-serif/);
  assert.match(tailwind, /fontFamily/);
  assert.match(tailwind, /sans: \["var\(--font-sans\)", "system-ui", "sans-serif"\]/);
  assert.doesNotMatch(`${layout}\n${globals}`, /fonts\.googleapis\.com|@import\s+url\(/);
});

test("launcher uses local Manrope assets without remote font URLs", async () => {
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

  for (const filename of expectedFonts) {
    const stat = await fsp.stat(path.join(fontDir, filename));
    assert.equal(stat.isFile(), true);
  }

  assert.match(tokens, /--font-sans: "Manrope", ui-sans-serif, system-ui/);
  assert.match(styles, /@font-face[\s\S]*font-family: "Manrope"[\s\S]*Manrope-Regular\.woff2/);
  assert.match(styles, /font-family: var\(--font-sans\)/);
  assert.match(styles, /font-weight: 400/);
  assert.match(styles, /HSL-MANROPE-TYPOGRAPHY-1/);
  assert.doesNotMatch(`${indexHtml}\n${tokens}\n${styles}`, /fonts\.googleapis\.com|fonts\.gstatic\.com|https?:\/\/[^"')\s]+/);
  assert.doesNotMatch(styles, /font-family: Inter/);
});
