import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const source = (path: string) => readFile(join(process.cwd(), path), "utf8");

test("normal web logout explicitly closes only the current browser session", async () => {
  const logout = await source("components/auth/logout-button.tsx");

  assert.match(logout, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(logout, /supabase\.auth\.signOut\(\s*\)/);
  assert.match(logout, /if \(error\)[\s\S]*setIsSubmitting\(false\)[\s\S]*return/);
  assert.match(logout, /router\.replace\("\/"\)[\s\S]*router\.refresh\(\)/);
});

test("every normal web-session cleanup is local while anonymization remains explicitly global", async () => {
  const [logout, profilePage, anonymizeRoute, anonymizeClient] = await Promise.all([
    source("components/auth/logout-button.tsx"),
    source("app/profile/page.tsx"),
    source("app/api/profile/anonymize/route.ts"),
    source("components/profile/profile-account-anonymization.tsx"),
  ]);
  const normalSources = `${logout}\n${profilePage}`;

  assert.equal((normalSources.match(/signOut\(\{ scope: "local" \}\)/g) || []).length, 3);
  assert.doesNotMatch(normalSources, /signOut\(\s*\)|scope: "global"/);
  assert.match(anonymizeRoute, /signOut\(\{ scope: "global" \}\)/);
  assert.match(anonymizeClient, /signOut\(\{ scope: "local" \}\)/);
});

test("local logout contract does not address launcher storage, Presence or local queues", async () => {
  const logout = await source("components/auth/logout-button.tsx");

  assert.doesNotMatch(logout, /launcher|known.?accounts|presence|playtime|submission|pending|refresh_token/i);
});
