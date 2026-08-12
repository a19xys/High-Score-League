import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const read = (...parts: string[]) => readFile(join(process.cwd(), ...parts), "utf8");

test("public landing consumes semantic light, system-dark and explicit-dark styles", async () => {
  const [landing, styles, themeSelect] = await Promise.all([
    read("components", "public-landing.tsx"),
    read("app", "globals.css"),
    read("components", "theme-select.tsx"),
  ]);
  const light = styles.slice(
    styles.indexOf(":root"),
    styles.indexOf("@media (prefers-color-scheme: dark)"),
  );
  const systemDark = styles.slice(
    styles.indexOf("@media (prefers-color-scheme: dark)"),
    styles.indexOf('html[data-theme="light"]'),
  );
  const explicitDark = styles.slice(
    styles.indexOf('html[data-theme="dark"]'),
    styles.indexOf("* {"),
  );

  for (const variable of [
    "--landing-bg-start",
    "--landing-card",
    "--landing-title",
    "--landing-body",
    "--landing-secondary",
    "--landing-logo-shadow",
  ]) {
    assert.match(light, new RegExp(variable));
    assert.match(systemDark, new RegExp(variable));
    assert.match(explicitDark, new RegExp(variable));
  }

  assert.match(styles, /:root:not\(\[data-theme="light"\]\)/);
  assert.match(styles, /html\[data-theme="dark"\]/);
  assert.match(landing, /public-landing-card/);
  assert.match(landing, /public-landing-title/);
  assert.match(landing, /public-landing-secondary-action/);
  assert.match(landing, /public-landing-logo-fallback/);
  assert.doesNotMatch(
    landing,
    /bg-slate-950\/70|border-white\/15|bg-white\/10|text-slate-200|text-white/,
  );
  assert.match(themeSelect, /delete document\.documentElement\.dataset\.theme/);
  assert.match(themeSelect, /matchMedia\("\(prefers-color-scheme: dark\)"\)/);
});

test("account deletion uses the normal button grammar with a red destructive variant", async () => {
  const [account, anonymization] = await Promise.all([
    read("components", "profile", "profile-account-settings.tsx"),
    read("components", "profile", "profile-account-anonymization.tsx"),
  ]);
  const trigger = anonymization.slice(
    anonymization.indexOf("return ("),
    anonymization.indexOf("{open ?"),
  );

  assert.doesNotMatch(
    account,
    /Eliminar la cuenta es irreversible; tu historial competitivo se conservará de forma anónima\./,
  );
  assert.match(trigger, /rounded-md/);
  assert.match(trigger, /px-4 py-3 text-sm font-semibold/);
  assert.match(trigger, /--destructive-border/);
  assert.match(trigger, /--destructive-text/);
  assert.doesNotMatch(trigger, /--warning-text|rounded-xl|font-extrabold/);
  assert.match(anonymization, />\s*Eliminar mi cuenta\s*</);
  assert.match(anonymization, /Tus mensajes y comentarios conservarán su texto original/);
});

test("admin current week is metadata-driven and spans two of six large-grid units", async () => {
  const center = await read("components", "profile", "admin-profile-center.tsx");

  assert.match(center, /title: "Semana actual"[\s\S]*featured: true/);
  assert.match(center, /xl:grid-cols-6/);
  assert.match(center, /sm:col-span-2 lg:col-span-2 xl:col-span-2/);
  assert.doesNotMatch(center, /xl:grid-cols-5|title === "Semana actual"/);
  assert.match(center, /data\.currentWeekId && data\.activeWeekCount === 1/);
  assert.match(center, /\? "\/admin\/weeks\/current"[\s\S]*: "\/admin\/weeks"/);
  assert.match(center, /Hay \{data\.activeWeekCount\} semanas activas/);
  assert.doesNotMatch(center, /Reportes|Avisos/);
});

test("season weeks preserve secret rows and one deterministic responsive dataset", async () => {
  const table = await read("components", "season-weeks-table.tsx");

  assert.equal((table.match(/weeks\.map/g) ?? []).length, 1);
  assert.match(table, /summary\.week\.status === "draft"/);
  assert.match(table, /summary\.week\.gameId === null/);
  assert.match(table, /summary\.week\.number > currentWeekNumber/);
  assert.match(table, /secret \? "Por anunciar" : summary\.game\.title/);
  assert.match(table, /<span aria-hidden="true" className="lg:hidden">—<\/span>/);
  assert.match(table, /<span className="hidden lg:inline">No disponible<\/span>/);
  assert.match(table, /href=\{`\/weeks\/\$\{summary\.week\.id\}`\}/);
  assert.match(table, /formatCompactDateRange/);
  assert.match(table, /truncate whitespace-nowrap/);
});
