import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolvePlayerPlayTimeApi } from "../lib/api/player-playtime.ts";
import { getPlayerPlayTimeSnapshot } from "../lib/data/player-playtime.ts";

type Scenario = {
  configured?: boolean;
  viewerId?: string | null;
  viewerError?: boolean;
  viewerActive?: boolean;
  target?: {
    anonymized?: boolean;
    id: string;
    playTimePublic: boolean;
  } | null;
  snapshotError?: unknown;
  total?: number | string | null;
};

function scenario(overrides: Scenario = {}) {
  const settings = {
    configured: true,
    viewerId: "viewer",
    viewerError: false,
    viewerActive: true,
    target: { anonymized: false, id: "target", playTimePublic: true },
    snapshotError: null,
    total: 12240,
    ...overrides,
  };
  let canonicalReads = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    async maybeSingle() {
      canonicalReads += 1;
      const target = settings.target;
      const totalVisibleThroughRls = target
        && (settings.viewerId === target.id || target.playTimePublic);
      return {
        data: !target || target.anonymized
          ? null
          : {
              id: target.id,
              play_time_public: target.playTimePublic,
              play_time_total: totalVisibleThroughRls && settings.total !== null
                ? [{ total_seconds: settings.total }]
                : [],
            },
        error: settings.snapshotError,
      };
    },
  };
  const client = { from: () => query };
  const dependencies = {
    createClient: async () => settings.configured ? client : null,
    getViewer: async () => settings.viewerError
      ? { status: "error" as const }
      : settings.viewerId
        ? { status: "signed-in" as const, userId: settings.viewerId }
        : { status: "signed-out" as const },
    hasActiveProfile: async () => ({ active: settings.viewerActive, error: null }),
    isValidUsername: (username: string) => /^[a-z0-9_-]{3,24}$/i.test(username),
    readSnapshot: (
      value: typeof client,
      username: string,
      viewerUserId: string,
    ) => getPlayerPlayTimeSnapshot(value as never, username, viewerUserId),
  };

  return {
    dependencies,
    get canonicalReads() { return canonicalReads; },
  };
}

test("Playtime API rejects missing configuration, session and invalid usernames", async () => {
  const notConfigured = scenario({ configured: false });
  assert.equal((await resolvePlayerPlayTimeApi("target", notConfigured.dependencies)).status, 503);

  const signedOut = scenario({ viewerId: null });
  assert.equal((await resolvePlayerPlayTimeApi("target", signedOut.dependencies)).status, 401);

  const invalid = scenario();
  assert.equal((await resolvePlayerPlayTimeApi("!", invalid.dependencies)).status, 400);
  assert.equal(invalid.canonicalReads, 0);
});

test("absent and anonymized targets retain the not-found contract", async () => {
  for (const target of [null, { anonymized: true, id: "target", playTimePublic: true }]) {
    const missing = scenario({ target });
    const result = await resolvePlayerPlayTimeApi("missing", missing.dependencies);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { ok: false, error: "Jugador no encontrado." });
    assert.equal(missing.canonicalReads, 1);
  }
});

test("private owner receives the total from one canonical relational snapshot", async () => {
  const owner = scenario({
    viewerId: "target",
    target: { id: "target", playTimePublic: false },
  });
  const result = await resolvePlayerPlayTimeApi("target", owner.dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    playTime: { visibility: "visible", totalSeconds: 12240 },
  });
  assert.equal(owner.canonicalReads, 1);
});

test("private third party receives no total from the same RLS-backed snapshot", async () => {
  const hidden = scenario({
    viewerId: "visitor",
    target: { id: "target", playTimePublic: false },
  });
  const result = await resolvePlayerPlayTimeApi("target", hidden.dependencies);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true,
    playTime: { visibility: "private" },
  });
  assert.equal(hidden.canonicalReads, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /totalSeconds/);
});

test("public third party and legitimately absent aggregates distinguish total from zero", async () => {
  const visible = scenario({ viewerId: "visitor" });
  assert.deepEqual(
    (await resolvePlayerPlayTimeApi("target", visible.dependencies)).body,
    { ok: true, playTime: { visibility: "visible", totalSeconds: 12240 } },
  );
  assert.equal(visible.canonicalReads, 1);

  const absent = scenario({ total: null });
  assert.deepEqual(
    (await resolvePlayerPlayTimeApi("target", absent.dependencies)).body,
    { ok: true, playTime: { visibility: "visible", totalSeconds: 0 } },
  );
  assert.equal(absent.canonicalReads, 1);
});

test("canonical snapshot errors become 503 and never a visible zero", async () => {
  const failed = scenario({ snapshotError: { message: "secret detail" }, total: null });
  const result = await resolvePlayerPlayTimeApi("target", failed.dependencies);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { ok: false, error: "Playtime no está disponible." });
  assert.doesNotMatch(JSON.stringify(result.body), /secret detail|totalSeconds/);
  assert.equal(failed.canonicalReads, 1);

  const invalid = scenario({ total: "not-a-number" });
  const invalidResult = await resolvePlayerPlayTimeApi("target", invalid.dependencies);
  assert.equal(invalidResult.status, 503);
  assert.doesNotMatch(JSON.stringify(invalidResult.body), /totalSeconds/);
  assert.equal(invalid.canonicalReads, 1);
});

test("the target privacy decision and aggregate are one PostgREST operation", async () => {
  const reader = await readFile(
    join(process.cwd(), "lib/data/player-playtime.ts"),
    "utf8",
  );
  const snapshotReader = reader.slice(
    reader.indexOf("export async function getPlayerPlayTimeSnapshot"),
    reader.indexOf("export async function getPlayerPlayTime("),
  );
  assert.equal((snapshotReader.match(/\.from\(/g) || []).length, 1);
  assert.equal((snapshotReader.match(/\.maybeSingle/g) || []).length, 1);
  assert.match(snapshotReader, /play_time_public/);
  assert.match(snapshotReader, /player_play_time_totals\(total_seconds\)/);
  assert.match(snapshotReader, /\.is\("anonymized_at", null\)/);
  assert.doesNotMatch(snapshotReader, /\.rpc\(|createSupabaseAdminClient|service_role|SECURITY DEFINER/i);
});

test("Playtime route remains dynamic, no-store, authenticated and under visitor RLS", async () => {
  const route = await readFile(
    join(process.cwd(), "app/api/players/[username]/playtime/route.ts"),
    "utf8",
  );
  assert.match(route, /dynamic = "force-dynamic"/);
  assert.match(route, /Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(route, /getClaims|getVerifiedProductIdentity|session-context|\.amr|AMR/);
  assert.match(route, /hasActiveProfile/);
  assert.match(route, /usernamePattern/);
  assert.match(route, /getPlayerPlayTimeSnapshot/);
  assert.doesNotMatch(route, /Admin|service.role|service_role|SECURITY DEFINER/i);
});
