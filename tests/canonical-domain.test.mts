import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_CANONICAL_SITE_ORIGIN,
  resolveCanonicalSiteOrigin,
  resolveRecoveryRedirectOrigin,
} from "../lib/site-origin.ts";

const root = process.cwd();
const source = (...parts: string[]) => readFile(join(root, ...parts), "utf8");

test("canonical site origin normalizes valid configuration and has a safe product fallback", () => {
  assert.equal(DEFAULT_CANONICAL_SITE_ORIGIN, "https://highscoreleague.com");
  assert.equal(
    resolveCanonicalSiteOrigin("https://highscoreleague.com", "production"),
    DEFAULT_CANONICAL_SITE_ORIGIN,
  );
  assert.equal(
    resolveCanonicalSiteOrigin("https://highscoreleague.com/", "production"),
    DEFAULT_CANONICAL_SITE_ORIGIN,
  );
  assert.equal(
    resolveCanonicalSiteOrigin(undefined, "production"),
    DEFAULT_CANONICAL_SITE_ORIGIN,
  );
  assert.equal(
    resolveCanonicalSiteOrigin("http://localhost:3000/", "development"),
    "http://localhost:3000",
  );
  assert.equal(
    resolveCanonicalSiteOrigin("http://localhost:3000", "production"),
    DEFAULT_CANONICAL_SITE_ORIGIN,
  );
});

test("canonical site origin rejects URLs that are not an HTTPS production origin", () => {
  const invalidOrigins = [
    "https://highscoreleague.com/foo",
    "https://highscoreleague.com?x=1",
    "https://highscoreleague.com#fragment",
    "https://user:pass@highscoreleague.com",
    "http://highscoreleague.com",
    "javascript:alert(1)",
    "data:text/plain,hsl",
    "ftp://highscoreleague.com",
    "not a URL",
  ];

  for (const value of invalidOrigins) {
    assert.equal(
      resolveCanonicalSiteOrigin(value, "production"),
      DEFAULT_CANONICAL_SITE_ORIGIN,
      value,
    );
  }
});

test("recovery keeps loopback in development and canonicalizes every public runtime host", () => {
  const publicRuntimeOrigins = [
    "https://highscoreleague.com",
    "https://high-score-league.vercel.app",
    "https://hsl-preview-123.vercel.app",
    "https://public.example",
  ];

  for (const runtimeOrigin of publicRuntimeOrigins) {
    assert.equal(
      resolveRecoveryRedirectOrigin(
        runtimeOrigin,
        "production",
        "https://highscoreleague.com",
      ),
      DEFAULT_CANONICAL_SITE_ORIGIN,
      runtimeOrigin,
    );
  }

  assert.equal(
    resolveRecoveryRedirectOrigin(
      "http://localhost:3000",
      "development",
      undefined,
    ),
    "http://localhost:3000",
  );
  assert.equal(
    resolveRecoveryRedirectOrigin(
      "http://127.0.0.1:3000",
      "development",
      undefined,
    ),
    "http://127.0.0.1:3000",
  );
  assert.equal(
    resolveRecoveryRedirectOrigin(
      "http://[::1]:3000",
      "development",
      undefined,
    ),
    "http://[::1]:3000",
  );
});

test("root metadata announces the canonical origin and only Home owns the slash canonical", async () => {
  const [layout, home] = await Promise.all([
    source("app", "layout.tsx"),
    source("app", "page.tsx"),
  ]);

  assert.match(layout, /metadataBase:\s*new URL\(canonicalSiteOrigin\)/);
  assert.doesNotMatch(layout, /alternates\s*:/);
  assert.doesNotMatch(layout, /window\.location|request\.nextUrl\.origin|headers\(\)/);
  assert.match(home, /alternates:\s*\{\s*canonical:\s*"\/"/s);
});

test("recovery UI resolves a redirect authority while registration keeps Supabase Site URL semantics", async () => {
  const [forgotPassword, passwordRecovery, register] = await Promise.all([
    source("components", "auth", "forgot-password-form.tsx"),
    source("lib", "auth", "password-recovery.ts"),
    source("components", "auth", "register-form.tsx"),
  ]);

  assert.match(
    forgotPassword,
    /redirectOrigin:\s*resolveRecoveryRedirectOrigin\(window\.location\.origin\)/,
  );
  assert.doesNotMatch(forgotPassword, /origin:\s*window\.location\.origin/);
  assert.match(passwordRecovery, /input\.redirectOrigin/);
  assert.doesNotMatch(register, /emailRedirectTo/);
});

test("legacy host remains direct and ranking capabilities preserve request-origin URLs", async () => {
  const [middleware, nextConfig, route] = await Promise.all([
    source("middleware.ts"),
    source("next.config.ts"),
    source("app", "api", "launcher", "ranking-capabilities", "route.ts"),
  ]);

  for (const routingSource of [middleware, nextConfig]) {
    assert.doesNotMatch(routingSource, /high-score-league\.vercel\.app/);
    assert.doesNotMatch(routingSource, /highscoreleague\.com/);
  }

  assert.equal(route.match(/request\.nextUrl\.origin/g)?.length, 2);
  assert.doesNotMatch(route, /canonicalSiteOrigin|DEFAULT_CANONICAL_SITE_ORIGIN/);
});

test("launcher smoke defaults to the canonical host, supports override and refuses redirects", async () => {
  const smoke = await source("scripts", "check-launcher-api.mjs");

  assert.match(
    smoke,
    /HSL_LAUNCHER_API_BASE_URL\s*\|\|\s*"https:\/\/highscoreleague\.com"/,
  );
  assert.equal(smoke.match(/redirect:\s*"manual"/g)?.length, 2);
  assert.match(smoke, /assertNoRedirect\(health/);
  assert.match(smoke, /assertNoRedirect\(response/);
});
